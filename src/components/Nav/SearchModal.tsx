import { ModalRootProps, ModalRoot, TextField } from '@decky/ui';
import React, { useEffect, useRef, useState } from 'react';

type MyProps = ModalRootProps & {
    setModalResult?(result: string): void;
    promptText: string;
};

export const SearchModal = ({
    closeModal,
    setModalResult,
    promptText,
}: MyProps) => {
    const [searchText, setSearchText] = useState('');
    const handleText = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchText(e.target.value);
    };
    const handleSubmit = () => {
        setModalResult && setModalResult(searchText);
        closeModal && closeModal();
    };
    const textField = useRef<any>(null);

    useEffect(() => {
        //This will open up the virtual keyboard
        textField.current?.element?.click();
    }, []);
    return (
        <ModalRoot closeModal={handleSubmit}>
            {/* No <form> here: ModalRoot already renders one, and Enter in a nested form navigates the Big Picture window away from Steam's UI */}
            <TextField
                //@ts-ignore
                ref={textField}
                focusOnMount={true}
                label="Search"
                //@ts-ignore
                placeholder={promptText}
                onChange={handleText}
            />
        </ModalRoot>
    );
};
