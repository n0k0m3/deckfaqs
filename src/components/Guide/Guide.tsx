import {
    DialogButton,
    Focusable,
    GamepadButton,
    GamepadEvent,
    Navigation,
    QuickAccessTab,
    Router,
} from '@decky/ui';
import {
    ElementType,
    ReactNode,
    useContext,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useEffect } from 'react';
import {
    AppContext,
    AppContextProvider,
    GuideContents,
} from '../../context/AppContext';
import parse, {
    HTMLReactParserOptions,
    Element,
    attributesToProps,
    domToReact,
    DOMNode,
} from 'html-react-parser';
import { routerHook } from '@decky/api';
import { ActionType } from '../../reducers/AppReducer';
import { loadGuidePage } from '../../utils';
import { TocDropdown } from '../Nav/TocDropdown';
import { Search } from '../Nav/Search';
import { ScrollPanel } from '../ScrollPanel';
import Mark from './mark';

type GuideProps = {
    fullscreen?: boolean;
};

// The guide renders in Steam's menu window, not in the plugin's window, so this code uses
// ownerDocument and no instanceof checks.

// Partly in the guide's view. The A button acts on the focused element, also after the D-pad
// scrolled it out of view, so actions check this first.
const inView = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    const panel = element?.closest?.('.deckfaqs_scrollpanel');
    if (!element || !panel) return true;
    const box = element.getBoundingClientRect();
    const view = panel.getBoundingClientRect();
    return box.bottom > view.top && box.top < view.bottom;
};

// Steam's navigation handle of a Focusable (its navRef). element.focus() moves only the browser
// focus, and Steam keeps sending the A button to the node that it thinks has focus.
type NavHandle = { TakeFocus: (button?: GamepadButton) => boolean };
const navHandles = new WeakMap<object, NavHandle>();

// Props for a link or spoiler Focusable: it registers its navigation handle for moveInView
const useGuideItem = () => {
    const element = useRef<HTMLDivElement>(null);
    const navRef = useRef<NavHandle>(null);
    useEffect(() => {
        if (element.current && navRef.current) {
            navHandles.set(element.current, navRef.current);
        }
    });
    return { ref: element, navRef, className: 'deckfaqs_item' };
};

// D-pad up and down move between the links and spoilers in view. With none left in view, the
// handler returns false and Steam's scroll panel scrolls the text. It starts from the view, not
// from the last focused item, so a TOC jump or a touch scroll does not pull the view back.
const moveInView = (content: HTMLElement, evt: GamepadEvent) => {
    const button = evt.detail.button;
    const down = button === GamepadButton.DIR_DOWN;
    if (!down && button !== GamepadButton.DIR_UP) return false;
    const items = [
        ...content.querySelectorAll<HTMLElement>('.deckfaqs_item'),
    ].filter(inView);
    if (!down) items.reverse();
    const current = items.indexOf(
        content.ownerDocument.activeElement as HTMLElement
    );
    const next = items[current + 1];
    const handle = next && navHandles.get(next);
    return !!handle && handle.TakeFocus(button);
};

// Links and spoilers are Focusable, so the D-pad and the A button reach them.
// Focusable calls onActivate for a click (or a tap) and for the A button.
type GuideLinkProps = {
    attribs: Record<string, string>;
    onFollow: () => void;
    children: ReactNode;
};
const GuideLink = ({ attribs, onFollow, children }: GuideLinkProps) => (
    <Focusable
        {...useGuideItem()}
        style={{ display: 'inline' }}
        noFocusRing
        focusClassName="deckfaqs_focus"
        onActivate={(e) => {
            // A link can be in a spoiler: do not also toggle the spoiler
            e.stopPropagation();
            if (inView(e.currentTarget)) onFollow();
        }}
    >
        <a
            {...attribs}
            className="deckfaqs-link"
            onClick={(e) => e.preventDefault()}
        >
            {children}
        </a>
    </Focusable>
);

const isSpoiler = (node: Element) =>
    (node.attribs.class ?? '')
        .split(/\s+/)
        .some((name) => name === 'fspoiler' || name === 'spoiler_box') ||
    node.attribs['data-spoiler'] === 'inline';

// Defined at module level, so React keeps the reveal state when the guide re-renders for an anchor
const Spoiler = ({
    node,
    options,
}: {
    node: Element;
    options: HTMLReactParserOptions;
}) => {
    const [revealed, setRevealed] = useState(false);
    const item = useGuideItem();
    const Tag = node.name as ElementType;
    const props = attributesToProps(node.attribs);
    return (
        <Focusable
            {...item}
            style={{ display: node.name === 'div' ? 'block' : 'inline' }}
            noFocusRing
            focusClassName="deckfaqs_focus"
            onActivate={(e) => {
                e.stopPropagation();
                if (inView(e.currentTarget)) setRevealed(!revealed);
            }}
        >
            <Tag
                {...props}
                className={`${props.className ?? ''}${
                    revealed ? ' deckfaqs_revealed' : ''
                }`}
            >
                {domToReact(node.children as DOMNode[], options)}
            </Tag>
        </Focusable>
    );
};

export const Guide = ({ fullscreen }: GuideProps) => {
    const { state, dispatch, browserView } = useContext(AppContext);
    const { currentGuide, search, isLoading } = state;
    const guideDiv = useRef<HTMLDivElement>(null);
    const stateRef = useRef(state);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    // Steam's ScrollPanel does not scroll on touch drags, so a drag moves it here.
    // Native listeners: React's synthetic touch events do not fire in Steam's menu window.
    useEffect(() => {
        const content = guideDiv.current;
        if (!content) return;
        const scrollContainer = () => {
            let element = content.parentElement;
            while (element && element.scrollHeight <= element.clientHeight) {
                element = element.parentElement;
            }
            return element;
        };
        let drag: { y: number; scrollTop: number } | null = null;
        const onStart = (e: TouchEvent) => {
            const panel = scrollContainer();
            drag = panel
                ? { y: e.touches[0].clientY, scrollTop: panel.scrollTop }
                : null;
        };
        const onMove = (e: TouchEvent) => {
            const panel = scrollContainer();
            if (!panel || !drag) return;
            const y = e.touches[0].clientY;
            // Skip the move if the browser scrolled the panel itself
            if (Math.abs(panel.scrollTop - drag.scrollTop) < 1) {
                panel.scrollTop += drag.y - y;
            }
            drag = { y, scrollTop: panel.scrollTop };
        };
        const onEnd = () => {
            drag = null;
        };
        content.addEventListener('touchstart', onStart, { passive: true });
        content.addEventListener('touchmove', onMove, { passive: true });
        content.addEventListener('touchend', onEnd);
        return () => {
            content.removeEventListener('touchstart', onStart);
            content.removeEventListener('touchmove', onMove);
            content.removeEventListener('touchend', onEnd);
        };
    }, [isLoading]);

    const options: HTMLReactParserOptions = {
        replace: (domNode) => {
            if (
                domNode instanceof Element &&
                domNode.attribs &&
                domNode.attribs.style
            ) {
                delete domNode.attribs.style;
            }
            if (
                domNode instanceof Element &&
                domNode.name === 'a' &&
                domNode.attribs &&
                domNode.attribs.href
            ) {
                const children = domNode.children;
                let anchor = '';
                if (domNode.attribs.href.startsWith('#')) {
                    anchor = domNode.attribs.href.substring(1);
                    return (
                        <GuideLink
                            attribs={domNode.attribs}
                            onFollow={() => {
                                dispatch({
                                    type: ActionType.UPDATE_GUIDE,
                                    payload: { ...currentGuide, anchor },
                                });
                            }}
                        >
                            {domToReact(children as DOMNode[])}
                        </GuideLink>
                    );
                } else {
                    anchor = domNode.attribs.href;
                    return (
                        <GuideLink
                            attribs={domNode.attribs}
                            onFollow={() => {
                                loadGuidePage(
                                    currentGuide,
                                    anchor,
                                    browserView,
                                    (result, _toc, images) => {
                                        if (anchor.indexOf('#') > 0) {
                                            anchor = anchor.substring(
                                                anchor.indexOf('#') + 1
                                            );
                                        } else {
                                            anchor = '';
                                        }
                                        dispatch({
                                            type: ActionType.UPDATE_GUIDE,
                                            payload: {
                                                ...currentGuide,
                                                guideHtml: result,
                                                images,
                                                anchor,
                                            },
                                        });
                                    }
                                );
                            }}
                        >
                            {domToReact(children as DOMNode[])}
                        </GuideLink>
                    );
                }
            } else if (
                domNode instanceof Element &&
                domNode.attribs &&
                isSpoiler(domNode)
            ) {
                return <Spoiler node={domNode} options={options} />;
            } else if (
                domNode instanceof Element &&
                domNode.name === 'div' &&
                domNode.attribs &&
                domNode.attribs.class === 'ftoc'
            ) {
                return <span></span>;
            } else if (
                domNode instanceof Element &&
                domNode.name === 'img' &&
                domNode.attribs &&
                domNode.attribs.src
            ) {
                return (
                    <img
                        {...domNode.attribs}
                        src={
                            currentGuide?.images?.[domNode.attribs.src] ??
                            `https://gamefaqs.gamespot.com${domNode.attribs.src}`
                        }
                    />
                );
            }
            return domNode;
        },
    };

    useEffect(() => {
        const anchor = state.currentGuide?.anchor;
        scrollToAnchor(anchor);
    }, [state.currentGuide?.anchor, state.currentGuide?.guideHtml]);

    const handleDismiss = (updatedGuide: GuideContents) => {
        dispatch({
            type: ActionType.UPDATE_GUIDE,
            payload: updatedGuide,
        });
    };
    const scrollToAnchor = (anchor: string = '') => {
        if (anchor.length > 0) {
            const elementToScrollTo =
                guideDiv.current?.querySelector(`[name="${anchor}"]`) ??
                guideDiv.current?.querySelector(`[id="${anchor}"]`);
            if (elementToScrollTo) {
                elementToScrollTo.scrollIntoView();
            } else {
                loadGuidePage(
                    currentGuide,
                    `#${anchor}`,
                    browserView,
                    (result, _toc, images) => {
                        dispatch({
                            type: ActionType.UPDATE_GUIDE,
                            payload: {
                                ...currentGuide,
                                guideHtml: result,
                                images,
                                anchor,
                            },
                        });
                    }
                );
            }
        } else {
            guideDiv.current?.querySelector('#faqwrap')?.scrollIntoView();
        }
    };

    useEffect(() => {
        if (guideDiv.current) {
            const { searchText } = search;
            const mark = new Mark(guideDiv.current?.querySelector('#faqwrap'));
            if (searchText) {
                mark.unmark({
                    done: () => {
                        mark.mark(searchText, {
                            className: 'deckfaqs_highlight',
                            separateWordSearch: false,
                            acrossElements: true,
                            done: (numMatches: number) => {
                                dispatch({
                                    type: ActionType.UPDATE_SEARCH,
                                    payload: {
                                        ...search,
                                        anchorIndex: 0,
                                        searchAnchorLength: numMatches,
                                    },
                                });
                            },
                        });
                    },
                });
            }
        }
    }, [search.searchText]);

    useEffect(() => {
        let elements = guideDiv.current?.querySelectorAll(
            '[class="deckfaqs_highlight"]'
        );
        if (
            elements &&
            search.anchorIndex >= 0 &&
            elements.length > search.anchorIndex
        ) {
            elements[search.anchorIndex].scrollIntoView();
        }
    }, [search.anchorIndex]);

    useEffect(() => {
        if (!fullscreen) {
            routerHook.addRoute('/deckfaqs-offline-fullscreen', () => {
                return (
                    <AppContextProvider
                        incomingState={stateRef.current}
                        browserView={browserView}
                    >
                        <FullScreenGuide onDismiss={handleDismiss} />
                    </AppContextProvider>
                );
            });
        }
        scrollToAnchor(currentGuide?.anchor);
        return function cleanup() {
            if (!fullscreen)
                routerHook.removeRoute('/deckfaqs-offline-fullscreen');
        };
    }, []);
    return useMemo(
        () =>
            isLoading ? (
                <div className="lds-ring">
                    <div></div>
                    <div></div>
                    <div></div>
                    <div></div>
                </div>
            ) : (
                <>
                    <style>
                        {`
                      .deckfaqs_highlight {
                        background-color: #FFFF00;
                      }
                      .deckfaqs_scrollpanel:focus-within {
                        outline: 2px solid rgba(255, 255, 255, 0.6);
                        outline-offset: 2px;
                      }
                      .deckfaqs_focus {
                        outline: 3px solid #1a9fff;
                        outline-offset: 1px;
                        border-radius: 2px;
                      }
                      .deckfaqs_dark .deckfaqs_focus {
                        outline-color: #e56000;
                      }
                      .deckfaqs_dark {
                        filter: invert(1)
                      }
                      .deckfaqs_dark img:not(.ignore-color-scheme),video:not(.ignore-color-scheme) {
                        filter: brightness(50%) invert(100%);
                      }
                      .deckfaqs_dark .deckfaqs_highlight {
                        filter: invert(1)
                      }
                      .ffaq {
                        font-size: 14px;
                        word-wrap: break-word;
                        color: #000;
                      }
                      .ffaq p {
                        line-height: 20px;
                      }
                      .deckfaqs-link {
                        color: blue !important;
                      }
                      .ffaq div.section_box,
                      .ffaq div.spoiler_box,
                      .ffaq blockquote {
                        background-color: #999;
                        border-style: solid;
                        border-width: 1px;
                        clear: left;
                        color: #0d0d0d;
                        display: table;
                        margin: 15px 15px 18px 0;
                        overflow: hidden;
                        padding: 5px;
                        width: 66%;
                      }
                      @media (max-width: 767px) {
                        .ffaq div.section_box,
                        .ffaq div.spoiler_box,
                        .ffaq blockquote {
                          overflow: auto;
                        }
                      }
                      @media (max-width: 767px) {
                        .ffaq div.section_box,
                        .ffaq div.spoiler_box,
                        .ffaq blockquote {
                          display: block;
                          overflow-x: scroll;
                          width: auto;
                        }
                      }
                      .ffaq div.section_box p:last-child,
                      .ffaq div.section_box ul:last-child,
                      .ffaq div.section_box ol:last-child,
                      .ffaq div.section_box dl:last-child,
                      .ffaq div.spoiler_box p:last-child,
                      .ffaq div.spoiler_box ul:last-child,
                      .ffaq div.spoiler_box ol:last-child,
                      .ffaq div.spoiler_box dl:last-child,
                      .ffaq blockquote p:last-child,
                      .ffaq blockquote ul:last-child,
                      .ffaq blockquote ol:last-child,
                      .ffaq blockquote dl:last-child {
                        margin-bottom: 0;
                      }
                      .ffaq div.spoiler_box,
                      .ffaq i[data-spoiler="inline"],
                      .ffaq .fspoiler,
                      .ffaq .fspoiler a {
                        background-color: #bbb;
                        border-color: #d9d9d9;
                        color: #bbb;
                      }
                      .ffaq .fspoiler.deckfaqs_revealed,
                      .ffaq .fspoiler.deckfaqs_revealed a,
                      .ffaq div.spoiler_box.deckfaqs_revealed,
                      .ffaq i[data-spoiler="inline"].deckfaqs_revealed {
                        color: #0d0d0d;
                      }
                      .ffaq i[data-spoiler="inline"] {
                        font-style: normal;
                      }
                      .ffaq i[data-spoiler="inline"] h6 {
                        color: #b31a1a;
                      }
                      .ffaq i[data-underline="inline"] {
                        font-style: normal;
                        text-decoration: underline;
                      }
                      .ffaq hr,
                      .ffaq pre {
                        margin-bottom: 18px;
                      }
                      .ffaq table {
                        border: 1px solid #000;
                        margin-bottom: 18px;
                        margin-right: 5px;
                        table-layout: fixed;
                        width: auto;
                      }
                      @media (max-width: 979px) {
                        .ffaq table {
                          clear: both;
                        }
                      }
                      @media (max-width: 767px) {
                        .ffaq table {
                          width: 100% !important;
                        }
                      }
                      @media (max-width: 767px) {
                        .ffaq table {
                          display: inline-table;
                          overflow-x: scroll;
                        }
                      }
                      .ffaq table tr:nth-child(2n + 1),
                      .ffaq table tr:nth-child(2n + 1) td {
                        background-color: #d3d3d3;
                      }
                      .ffaq table td,
                      .ffaq table th {
                        background-color: #d3d3d3;
                        border: 1px solid #000;
                        color: #0d0d0d;
                        box-shadow: none;
                        font: inherit;
                        padding: 3px 5px;
                        text-shadow: none;
                        vertical-align: middle;
                      }
                      @media (max-width: 767px) {
                        .ffaq table td,
                        .ffaq table th {
                          font-size: 10px;
                          padding: 1px;
                        }
                      }
                      .ffaq table td.l,
                      .ffaq table th.l {
                        text-align: left;
                      }
                      .ffaq table td.c,
                      .ffaq table th.c {
                        text-align: center;
                      }
                      .ffaq table td.r,
                      .ffaq table th.r {
                        text-align: right;
                      }
                      .ffaq table td img,
                      .ffaq table th img {
                        max-width: none !important;
                      }
                      .ffaq table td p:last-child,
                      .ffaq table th p:last-child {
                        margin-bottom: 0;
                      }
                      .ffaq table tr {
                        border: 1px solid #000;
                      }
                      .ffaq table th,
                      .ffaq table thead td {
                        background-color: #999999 !important;
                        font-weight: bold;
                        text-align: center;
                      }
                      .ffaq table.unmargin {
                        display: inline-table;
                      }
                      .ffaq div.fimg_small,
                      .ffaq div.fimg_smallleft,
                      .ffaq div.fimg_smallright,
                      .ffaq div.fimg_large,
                      .ffaq div.fimg_largeleft,
                      .ffaq div.cimg_s,
                      .ffaq div.cimg_l {
                        font-size: 10px;
                        border-style: solid;
                        border-width: 1px;
                        padding: 2px;
                      }
                      .ffaq div.fimg_small,
                      .ffaq div.cimg_s {
                        clear: right;
                        float: right;
                        margin: 10px 10px 18px;
                        max-width: 300px;
                      }
                      @media (max-width: 767px) {
                        .ffaq div.fimg_small,
                        .ffaq div.cimg_s {
                          clear: both;
                          display: inline-block;
                          float: none;
                          margin: 0 0 10px;
                        }
                      }
                      .ffaq div.fimg_smallleft,
                      .ffaq div.cimg_sleft {
                        clear: left;
                        float: left;
                        margin: 10px 20px 10px 10px;
                        max-width: 300px;
                      }
                      @media (max-width: 767px) {
                        .ffaq div.fimg_smallleft,
                        .ffaq div.cimg_sleft {
                          clear: both;
                          display: inline-block;
                          float: none;
                          margin: 0 0 10px;
                        }
                      }
                      .ffaq div.fimg_smallright,
                      .ffaq div.cimg_sright {
                        clear: right;
                        float: right;
                        margin: 10px 10px 10px 20px;
                        max-width: 300px;
                      }
                      @media (max-width: 767px) {
                        .ffaq div.fimg_smallright,
                        .ffaq div.cimg_sright {
                          clear: both;
                          display: inline-block;
                          float: none;
                          margin: 0 0 10px;
                        }
                      }
                      .ffaq div.fimg_largeleft {
                        clear: left;
                        float: left;
                        margin: 10px 10px 18px;
                        max-width: 750px;
                      }
                      @media (max-width: 767px) {
                        .ffaq div.fimg_largeleft {
                          margin: 0;
                          max-width: 100%;
                        }
                      }
                      .ffaq div.fimg_large,
                      .ffaq div.cimg_l {
                        clear: both;
                        float: left;
                        margin: 10px 10px 18px;
                        max-width: 750px;
                      }
                      @media (max-width: 767px) {
                        .ffaq div.fimg_large,
                        .ffaq div.cimg_l {
                          margin: 0;
                        }
                      }
                      .ffaq div.clear {
                        clear: left;
                      }
                      .ffaq img.fimg_small,
                      .ffaq img.fimg_large,
                      .ffaq img.cimg_s,
                      .ffaq img.cimg_l {
                        height: auto;
                        max-width: 100% !important;
                        width: auto;
                      }
                      .ffaq img.imgleft {
                        float: left;
                        margin-right: 10px;
                      }
                      .ffaq img.imgright {
                        float: right;
                        margin-left: 10px;
                      }
                      .ffaq img.imgnofloat {
                        float: none;
                        margin-right: 2px;
                        vertical-align: middle;
                      }
                      @media (max-width: 767px) {
                        .ffaq img.bigresize {
                          height: 100% !important;
                          width: 100% !important;
                        }
                        .ffaq table img.bigresize {
                          height: auto !important;
                          width: auto !important;
                          max-height: 100% !important;
                          max-width: 100% !important;
                        }
                      }
                      .ffaq ol,
                      .ffaq ul {
                        margin-bottom: 18px;
                        padding-left: 40px;
                      }
                      .ffaq ol li,
                      .ffaq ul li {
                        line-height: 18px;
                        margin-bottom: 0;
                        padding: 3px 0;
                      }
                      .ffaq ol li ol,
                      .ffaq ol li ul,
                      .ffaq ul li ol,
                      .ffaq ul li ul {
                        margin-bottom: 0;
                      }
                      .ffaq:not(.faq_menu_wrap) ul + li,
                      .ffaq:not(.faq_menu_wrap) ol + li {
                        margin-top: -20px;
                      }
                      .ffaq dl dl {
                        text-indent: 15px;
                      }
                      .ffaq dl dl dl {
                        text-indent: 40px;
                      }
                      .ffaq dl dl dl dl {
                        text-indent: 65px;
                      }
                      .ffaq .faqtext {
                        margin: 0 auto !important;
                        background: #fff;
                      }
                      @media (max-width: 767px) {
                        .ffaq .faqtext {
                          overflow-x: auto;
                        }
                      }
                      @media (min-width: 768px) {
                        .ffaq .faqtext {
                          padding: 25px 100px;
                        }
                      }
                      @media (max-width: 767px) {
                        .ffaq .faqtext {
                          background: none !important;
                        }
                      }
                      .ffaq .faqtext pre {
                        margin: 0px !important;
                        white-space: pre-wrap;
                        font: 14px "Courier New", "Courier", monospace !important;
                      }
                      @media (max-width: 767px) {
                        .ffaq .faqtext pre {
                          font: 11px "Courier New", "Courier", monospace !important;
                        }
                      }
                      .ffaq.imgmain {
                        display: table;
                        margin: 0 auto;
                      }
                      .ffaq.imgmain p {
                        font-size: 12px;
                        margin-bottom: 0;
                      }
                      .ffaq.imgmain img.imgresize {
                        max-width: 100%;
                        width: 100%;
                      }`}
                    </style>
                    {/* Not focusable itself: the D-pad goes straight to the guide and scrolls it.
                        60% per press, like Steam's own long-text panels; the default is 30%. */}
                    <ScrollPanel
                        focusable={false}
                        scrollStepPercent={60}
                        style={{
                            flexGrow: '1',
                            overflow: 'auto',
                            height: '100%',
                            margin: fullscreen ? '10px' : '0px',
                        }}
                        className="deckfaqs_scrollpanel"
                    >
                        <Focusable
                            //@ts-ignore Steam's Focusable takes it, @decky/ui does not type it
                            focusable={true}
                            noFocusRing
                            style={{ background: '#fff' }}
                            className={state.darkMode ? 'deckfaqs_dark' : ''}
                            ref={guideDiv}
                            onGamepadDirection={(evt) =>
                                !!guideDiv.current &&
                                moveInView(guideDiv.current, evt)
                            }
                        >
                            {parse(currentGuide?.guideHtml ?? '', options)}
                        </Focusable>
                    </ScrollPanel>
                </>
            ),
        [currentGuide, isLoading]
    );
};

const navButtonStyle = {
    width: '200px',
    padding: '10px 12px',
};

type FullScreenGuideProps = {
    onDismiss: (updatedGuide: GuideContents) => void;
};
const FullScreenGuide = ({ onDismiss }: FullScreenGuideProps) => {
    const { state } = useContext(AppContext);
    const guide = useRef(state.currentGuide);

    useEffect(() => {
        guide.current = state.currentGuide;
    }, [state.currentGuide]);

    useEffect(() => {
        return function cleanup() {
            guide.current && onDismiss(guide.current);
        };
    }, []);
    return (
        <div
            style={{
                display: 'flex',
                flexFlow: 'column',
                marginTop: '50px',
                flexGrow: '1',
                overflow: 'auto',
                color: '#000',
            }}
        >
            <div
                style={{
                    margin: '0 10px',
                    display: 'flex',
                }}
            >
                <Focusable style={{ display: 'flex', width: '100%' }}>
                    {Router.MainRunningApp !== undefined && (
                        <DialogButton
                            //@ts-ignore
                            disableNavSounds={true}
                            style={{ minWidth: '0px', marginRight: '10px' }}
                            onClick={() => {
                                setTimeout(
                                    //@ts-ignore
                                    () => Router.NavigateToRunningApp(),
                                    200
                                );
                            }}
                        >
                            Back to Game
                        </DialogButton>
                    )}
                    <DialogButton
                        //@ts-ignore
                        disableNavSounds={true}
                        style={{ ...navButtonStyle, marginRight: '10px' }}
                        onClick={() => {
                            Navigation.NavigateBack();
                            setTimeout(() => {
                                Navigation.OpenQuickAccessMenu(
                                    QuickAccessTab.Decky
                                );
                            }, 200);
                        }}
                    >
                        Back to DeckFAQs
                    </DialogButton>
                    {state.currentGuide &&
                        state.currentGuide.guideToc!.length > 0 && (
                            <TocDropdown
                                style={{
                                    minWidth: '200px',
                                    marginRight: '10px',
                                }}
                            />
                        )}
                    <Search fullScreen={true} />
                </Focusable>
            </div>
            <Guide fullscreen={true} />
        </div>
    );
};
