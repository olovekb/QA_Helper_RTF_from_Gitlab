// rich text editor
import React, { useMemo, useRef, useEffect } from 'react';
import MDEditor, { getCommands, getExtraCommands, headingExecute, group, selectWord, executeCommand, bold, italic, code, codeBlock, quote, strikethrough } from '@uiw/react-md-editor';
import { useTheme } from '../ThemeContext';
import './JiraMarkdownField.css';

//Отображение для превью в хелпере
// заголовки (h1, h2, h3...) в (# ## ...)
const jiraHeadingsToMarkdown = (text) =>
{
    if (!text) return '';
    return text.replace(/^(h[1-6])\.\s+/gm, (_, h) => '#'.repeat(parseInt(h[1], 10)) + ' ');
};

// ссылки [text|url] в [text](url)
const jiraLinksToMarkdown = (text) =>
{
    if (!text) return '';
    return text.replace(/\[([^\]]+)\|([^\^][^\]]*)\]/g, '[$1]($2)');
};

// зачёркнутый -text- в ~~text~~
const jiraStrikethroughToMarkdown = (text) =>
{
    if (!text) return '';
    return text.replace(/(^|\s)-(\S(?:[^-]*\S)?)-(?=[\s.,;:!?)\]}]|$)/gm, '$1~~$2~~');
};

// жирный *text* в **text**, курсив _text_ в *text*
const jiraBoldItalicToMarkdown = (text) =>
{
    if (!text) return '';
    let result = text;
    result = result.replace(/\*([^*\n]+)\*/g, '**$1**');
    result = result.replace(/_([^_\n]+)_/g, '*$1*');
    return result;
};

// цитата bq. text в > text
const jiraQuoteToMarkdown = (text) =>
{
    if (!text) return '';
    return text.replace(/^bq\.\s+/gm, '> ');
};

// блок кода {code}...{code} → ```...```, inline {{text}} → `text`
const jiraCodeBlockToMarkdown = (text) =>
{
    if (!text) return '';
    let result = text.replace(/\{code\}([\s\S]*?)\{code\}/g, '```$1```');
    result = result.replace(/\{\{([^}]+)\}\}/g, '`$1`');
    return result;
};

// картинки [text|^filename] и !filename|thumbnail! в ![alt](blob:url)
function JiraPreviewWithImages ({ source, imageAttachments = [] })
{
    const blobUrlsRef = useRef(new Set());

    const transformed = useMemo(() =>
    {
        blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        blobUrlsRef.current.clear();

        let result = jiraHeadingsToMarkdown(source);
        result = jiraBoldItalicToMarkdown(result);
        // защита [text|^filename] и !filename|thumbnail! от преобразования в зачеркнутый текст
        const imageRefs = [];
        result = result.replace(/\[([^\]]+)\|\^([^\]]+)\]/g, (_, alt, filename) =>
        {
            imageRefs.push({ type: 'bracket', alt, filename });
            return `\u200BIMG\u200B${imageRefs.length - 1}\u200B`;
        });
        result = result.replace(/!([^!|]+)(?:\|thumbnail)?!/g, (_, filename) =>
        {
            imageRefs.push({ type: 'bang', filename });
            return `\u200BIMG\u200B${imageRefs.length - 1}\u200B`;
        });
        // защита разделителей markdown-таблиц (|--------|) от jiraStrikethrough (-text- → ~~text~~)
        const tableSeparators = [];
        result = result.replace(/^\|[\s\-:|]+\|$/gm, (match) =>
        {
            tableSeparators.push(match);
            return `\u200BTBL\u200B${tableSeparators.length - 1}\u200B`;
        });
        result = jiraStrikethroughToMarkdown(result);
        result = result.replace(/\u200BTBL\u200B(\d+)\u200B/g, (_, i) => tableSeparators[parseInt(i, 10)] || '');
        result = result.replace(/\u200BIMG\u200B(\d+)\u200B/g, (_, i) =>
        {
            const ref = imageRefs[parseInt(i, 10)];
            if (!ref) return '';
            if (ref.type === 'bracket') return `[${ref.alt}|^${ref.filename}]`;
            return `!${ref.filename}|thumbnail!`;
        });
        result = jiraQuoteToMarkdown(result);
        result = jiraCodeBlockToMarkdown(result);
        const fileByName = (name) => imageAttachments.find(f => f && String(f.name || '').trim() === String(name || '').trim());

        // [text|^filename] в изображение
        result = result.replace(/\[([^\]]+)\|\^([^\]]+)\]/g, (_, alt, filename) =>
        {
            const item = fileByName(filename.trim());
            if (item) {
                if (item instanceof File) {
                    const url = URL.createObjectURL(item);
                    blobUrlsRef.current.add(url);
                    return `![${alt}](${url})`;
                }
                if (item.dataUrl) return `![${alt}](${item.dataUrl})`;
            }
            return `[${alt}|^${filename}]`;
        });

        // !filename|thumbnail!
        result = result.replace(/!([^!|]+)(?:\|thumbnail)?!/g, (_, filename) =>
        {
            const item = fileByName(filename.trim());
            if (item) {
                if (item instanceof File) {
                    const url = URL.createObjectURL(item);
                    blobUrlsRef.current.add(url);
                    return `![${filename}](${url})`;
                }
                if (item.dataUrl) {
                    return `![${filename}](${item.dataUrl})`;
                }
            }
            return `*[${filename}]*`;
        });
        result = jiraLinksToMarkdown(result);
        return result;
    }, [source, imageAttachments]);

    useEffect(() => () =>
    {
        blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        blobUrlsRef.current.clear();
    }, []);

    return <MDEditor.Markdown source={ transformed } />;
}

const createJiraHeading = (level, label) => ({
    name: `heading${level}`,
    keyCommand: `heading${level}`,
    shortcuts: `ctrlcmd+${level}`,
    prefix: `h${level}. `,
    suffix: '',
    buttonProps: { title: `Заголовок ${level} (Ctrl + ${level})` },
    icon: <div style={ { fontSize: 20 - level * 2, textAlign: 'left' } }>{ label }</div>,
    execute: (state, api) =>
    {
        headingExecute({
            state,
            api,
            prefix: `h${level}. `,
            suffix: ''
        });
    }
});

const jiraHeading1 = createJiraHeading(1, 'Heading 1');
const jiraHeading2 = createJiraHeading(2, 'Heading 2');
const jiraHeading3 = createJiraHeading(3, 'Heading 3');
const jiraHeading4 = createJiraHeading(4, 'Heading 4');
const jiraHeading5 = createJiraHeading(5, 'Heading 5');
const jiraHeading6 = createJiraHeading(6, 'Heading 6');

const jiraTitleGroup = group([jiraHeading1, jiraHeading2, jiraHeading3, jiraHeading4, jiraHeading5, jiraHeading6], {
    name: 'title',
    groupName: 'title',
    buttonProps: { title: 'Вставить заголовок' }
});

const jiraBold = {
    ...bold,
    prefix: '*',
    suffix: '*',
    buttonProps: { title: 'Жирный текст (Ctrl + B)' }
};

const jiraItalic = {
    ...italic,
    prefix: '_',
    suffix: '_',
    buttonProps: { title: 'Курсив (Ctrl + I)' }
};

const jiraStrikethrough = {
    ...strikethrough,
    prefix: '-',
    suffix: '-',
    buttonProps: { title: 'Зачеркнутый текст (Ctrl + Shift + X)' }
};

const jiraImage = {
    name: 'image',
    keyCommand: 'image',
    shortcuts: 'ctrlcmd+k',
    buttonProps: { title: 'Добавить изображение (Ctrl + K)' },
    icon: (
        <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
            <path d="M15 9c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4-7H1c-.55 0-1 .45-1 1v14c0 .55.45 1 1 1h18c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1zm-1 13l-6-5-2 2-4-5-4 8V4h16v11z" />
        </svg>
    ),
    execute: (state, api) =>
    {
        const selectedText = state.selectedText || 'text';
        executeCommand({
            api,
            selectedText,
            selection: state.selection,
            prefix: '[',
            suffix: '|^image.png]'
        });
    }
};

const jiraCodeBlock = {
    name: 'codeBlock',
    keyCommand: 'codeBlock',
    shortcuts: 'ctrlcmd+shift+j',
    buttonProps: { title: 'Вставить блок кода (Ctrl + Shift + J)' },
    icon: (
        <svg width="13" height="13" viewBox="0 0 156 156" fill="currentColor">
            <path d="M110.85 120.575 43.7 120.483333 43.7083334 110.091667 110.85 110.191667 110.841667 120.583333 110.85 120.575ZM85.1333334 87.1916666 43.625 86.7083332 43.7083334 76.3166666 85.2083334 76.7916666 85.1333334 87.1916666 85.1333334 87.1916666ZM110.841667 53.4166666 43.7 53.3166666 43.7083334 42.925 110.85 43.025 110.841667 53.4166666ZM36 138C27.2916666 138 20.75 136.216667 16.4 132.666667 12.1333334 129.2 10 124.308333 10 118L10 95.3333332C10 91.0666666 9.25 88.1333332 7.7333334 86.5333332 6.3166668 84.8416666 3.7333334 84 0 84L0 72C3.7333334 72 6.3083334 71.2 7.7333334 69.6 9.2416668 67.9083334 10 64.9333334 10 60.6666666L10 38C10 31.775 12.1333334 26.8833334 16.4 23.3333332 20.7583334 19.7749998 27.2916666 18 36 18L40.6666668 18 40.6666668 30 36 30C34.0212222 29.9719277 32.1263151 30.7979128 30.8 32.2666666 29.3605875 33.8216362 28.5938182 35.8823287 28.6666668 38L28.6666668 60.6666666C28.6666668 67.5083332 26.6666668 72.4 22.6666668 75.3333332 20.9317416 76.7274684 18.8640675 77.6464347 16.6666668 78 18.8916668 78.35 20.8916668 79.2416666 22.6666668 80.6666666 26.6666668 83.95 28.6666668 88.8416666 28.6666668 95.3333332L28.6666668 118C28.6666668 120.308333 29.3750002 122.216667 30.8 123.733333 32.2166666 125.241667 33.9583334 126 36 126L40.6666668 126 40.6666668 138 36 138 36 138ZM114.116667 126 118.783333 126C120.833333 126 122.566667 125.241667 123.983333 123.733333 125.422746 122.178364 126.189515 120.117671 126.116667 118L126.116667 95.3333332C126.116667 88.8333332 128.116667 83.9499998 132.116667 80.6666666 133.9 79.2416666 135.9 78.35 138.116667 78 135.919156 77.6468047 133.851391 76.7277979 132.116667 75.3333332 128.116667 72.3999998 126.116667 67.5 126.116667 60.6666666L126.116667 38C126.189515 35.8823287 125.422746 33.8216361 123.983333 32.2666666 122.657018 30.7979128 120.762111 29.9719277 118.783333 30L114.116667 30 114.116667 18 118.783333 18C127.5 18 133.983333 19.775 138.25 23.3333332 142.608333 26.8833332 144.783333 31.7749998 144.783333 38L144.783333 60.6666666C144.783333 64.9333332 145.5 67.9083332 146.916667 69.6 148.433333 71.2 151.05 72 154.783333 72L154.783333 84C151.05 84 148.433333 84.8333334 146.916667 86.5333332 145.5 88.1333332 144.783333 91.0666666 144.783333 95.3333332L144.783333 118C144.783333 124.308333 142.616667 129.2 138.25 132.666667 133.983333 136.216667 127.5 138 118.783333 138L114.116667 138 114.116667 126 114.116667 126Z" />
        </svg>
    ),
    execute: (state, api) =>
    {
        const blockPrefix = '\n{code}\n';
        const blockSuffix = '\n{code}\n';
        const newSelectionRange = selectWord({
            text: state.text,
            selection: state.selection,
            prefix: blockPrefix,
            suffix: blockSuffix
        });
        const state1 = api.setSelectionRange(newSelectionRange);
        let usePrefix = '\n{code}\n';
        let useSuffix = '\n{code}\n';
        if (state1.selectedText.length >= blockPrefix.length + blockSuffix.length - 2 &&
            state1.selectedText.startsWith(blockPrefix) && state1.selectedText.endsWith(blockSuffix)) {
            usePrefix = blockPrefix;
            useSuffix = blockSuffix;
        } else {
            usePrefix = (state1.selection.start === 0 || state.text[state1.selection.start - 1] === '\n') ? '{code}\n' : '\n{code}\n';
            useSuffix = (state1.selection.end >= state.text.length || state.text[state1.selection.end] === '\n') ? '\n{code}' : '\n{code}\n';
        }
        const newSelectionRange2 = selectWord({
            text: state.text,
            selection: state.selection,
            prefix: usePrefix,
            suffix: useSuffix
        });
        const state2 = api.setSelectionRange(newSelectionRange2);
        executeCommand({
            api,
            selectedText: state2.selectedText,
            selection: state.selection,
            prefix: usePrefix,
            suffix: useSuffix
        });
    }
};

const jiraCode = {
    ...code,
    buttonProps: { title: 'Код (Ctrl + J)' },
    execute: (state, api) =>
    {
        if (state.selectedText.indexOf('\n') === -1) {
            const newSelectionRange = selectWord({
                text: state.text,
                selection: state.selection,
                prefix: '{{',
                suffix: '}}'
            });
            const state1 = api.setSelectionRange(newSelectionRange);
            executeCommand({
                api,
                selectedText: state1.selectedText,
                selection: state.selection,
                prefix: '{{',
                suffix: '}}'
            });
        } else {
            jiraCodeBlock.execute(state, api);
        }
    }
};

const jiraQuote = {
    ...quote,
    prefix: 'bq. ',
    buttonProps: { title: 'Цитата (Ctrl + Q)' }
};

const jiraLink = {
    name: 'link',
    keyCommand: 'link',
    shortcuts: 'ctrlcmd+l',
    prefix: '[',
    suffix: '|url]',
    buttonProps: { title: 'Добавить ссылку (Ctrl + L)' },
    icon: (
        <svg width="12" height="12" viewBox="0 0 520 520" fill="currentColor">
            <path d="M331.75 182.12c60.69 59.85 59.86 155.81.37 214.75l-68.26 67.25c-60.2 59.31-158.15 59.31-218.34 0-60.2-59.31-60.2-155.82 0-215.12l37.69-37.13c9.99-9.85 27.21-3.3 27.72 10.61.66 17.74 3.89 35.55 9.85 52.76 2.02 5.83.58 12.27-3.84 16.62l-13.29 13.1c-28.47 28.05-29.36 73.72-1.18 102.04 28.46 28.6 75.25 28.77 103.93.51l68.26-67.24c28.63-28.21 28.51-73.81-.02-101.9-3.76-3.7-7.55-6.57-10.5-8.58-4.24-2.87-6.86-7.55-7.06-12.62-.4-10.57 3.4-21.47 11.88-29.83l21.39-21.08c5.61-5.52 14.4-6.2 20.91-1.73 7.45 5.12 14.42 10.88 20.84 17.21zm-91.05-126.64l-68.26 67.25c-.12.12-.25.25-.36.37-54.38 56.23-42.13 138.47 13.28 205.73 5.68 6.89 13.4 12.08 20.84 17.21 6.5 4.47 15.3 3.79 20.91-1.73l21.38-21.07c8.48-8.36 12.28-19.26 11.88-29.83-.2-5.07-2.82-9.75-7.06-12.62-3.96-2.01-7.74-4.88-11.5-8.58-28.52-28.09-36.62-67.38-12.93-92.87l68.26-67.25c28.68-28.26 75.47-28.09 103.93.51 28.19 28.32 27.29 73.99-1.17 102.04l-12.41 12.13c-4.42 4.35-5.86 10.8-3.84 16.62 5.96 17.21 9.19 35.02 9.85 52.76.52 13.91 17.73 20.46 27.72 10.61l37.69-37.13c60.2-59.31 60.2-155.82 0-215.12-60.19-59.31-158.14-59.31-218.34 0z" />
        </svg>
    ),
    execute: (state, api) =>
    {
        const newSelectionRange = selectWord({
            text: state.text,
            selection: state.selection,
            prefix: '[',
            suffix: '|url]'
        });
        const state1 = api.setSelectionRange(newSelectionRange);
        if (state1.selectedText.includes('http') || state1.selectedText.includes('www')) {
            executeCommand({
                api,
                selectedText: state1.selectedText,
                selection: state.selection,
                prefix: '[|',
                suffix: ']'
            });
        } else {
            executeCommand({
                api,
                selectedText: state1.selectedText,
                selection: state.selection,
                prefix: '[',
                suffix: '|url]'
            });
        }
    }
};

const CMD_TITLES = {
    comment: 'Комментарий (Ctrl + /)',
    table: 'Вставить таблицу',
    help: 'Справка по разметке',
    'unordered-list': 'Маркированный список (Ctrl + Shift + U)',
    'ordered-list': 'Нумерованный список (Ctrl + Shift + O)',
    'checked-list': 'Чек-лист (Ctrl + Shift + C)'
};

// Подсказки для режимов редактирования и превью (extraCommands)
const EXTRA_CMD_TITLES = {
    edit: 'Редактирование (Ctrl + 7)',
    live: 'Редактирование с предпросмотром (Ctrl + 8)',
    preview: 'Только предпросмотр (Ctrl + 9)'
};

const defaultCmds = getCommands();
const defaultExtraCmds = getExtraCommands();
const jiraExtraCommands = defaultExtraCmds
    .filter(cmd => cmd.keyCommand !== 'fullscreen')
    .map(cmd =>
    {
        const title = EXTRA_CMD_TITLES[cmd.value];
        if (title) {
            return { ...cmd, buttonProps: { ...cmd.buttonProps, title } };
        }
        return cmd;
    });

const jiraCommands = defaultCmds
    .filter(cmd => cmd.keyCommand !== 'hr')
    .map((cmd, i) =>
    {
        if (cmd.keyCommand === 'bold') return jiraBold;
        if (cmd.keyCommand === 'italic') return jiraItalic;
        if (cmd.keyCommand === 'strikethrough') return jiraStrikethrough;
        if (cmd.keyCommand === 'image') return jiraImage;
        if (cmd.keyCommand === 'link') return jiraLink;
        if (cmd.keyCommand === 'quote') return jiraQuote;
        if (cmd.keyCommand === 'codeBlock') return jiraCodeBlock;
        if (cmd.keyCommand === 'code') return jiraCode;
        if (cmd.groupName === 'title' || cmd.name === 'title') return jiraTitleGroup;
        const title = CMD_TITLES[cmd.keyCommand] || CMD_TITLES[cmd.name];
        if (title) {
            return { ...cmd, buttonProps: { ...cmd.buttonProps, title } };
        }
        return cmd;
    });

export default function JiraMarkdownField ({
    value = '',
    onChange,
    onPaste,
    onBlur,
    imageAttachments = [],
    id,
    placeholder,
    minHeight = 136,
    visibleDragbar = true,
    preview = 'edit'
})
{
    const { theme } = useTheme();
    const handlePasteCapture = (e) =>
    {
        if (typeof onPaste === 'function' && e.clipboardData?.files?.length) {
            e.preventDefault();
            e.stopPropagation();
            onPaste(e);
        }
    };

    return (
        <div
            className="jira-markdown-field"
            data-color-mode={ theme }
            onPasteCapture={ handlePasteCapture }
        >
            <MDEditor
                id={ id }
                value={ value ?? '' }
                onChange={ onChange }
                commands={ jiraCommands }
                extraCommands={ jiraExtraCommands }
                placeholder={ placeholder }
                height={ minHeight }
                visibleDragbar={ visibleDragbar }
                preview={ preview }
                components={ {
                    preview: (source) => (
                        <JiraPreviewWithImages source={ source } imageAttachments={ imageAttachments } />
                    )
                } }
                textareaProps={ {
                    'data-placeholder': placeholder,
                    ...(onBlur && { onBlur })
                } }
            />
        </div>
    );
}
