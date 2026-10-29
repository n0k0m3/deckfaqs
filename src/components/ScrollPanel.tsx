import { ScrollPanelGroup } from '@decky/ui';
import { FC, ReactNode, HTMLAttributes, RefAttributes } from 'react';

//Unclear how many of these have an effect (also probably not exhaustive)
interface ScrollPanelProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
    scrollDirection?: 'x' | 'y' | 'both';
    focusable?: boolean;
    autoFocus?: boolean;
    scrollStepPercent?: number;
    scrollBehavior?: string;
    noFocusRing?: boolean;
    onOKButton?: (e: CustomEvent) => void;
    onCancelButton?: (e: CustomEvent) => void;
}

// Steam's ScrollPanelGroup, the component upstream found by its props. It scrolls on D-pad input.
// @decky/ui's ScrollPanel is a different, plain scroll container with no gamepad handling.
// @decky/ui types it with children only, but it takes the props above.
export const ScrollPanel = ScrollPanelGroup as FC<
    ScrollPanelProps & RefAttributes<HTMLDivElement>
>;
