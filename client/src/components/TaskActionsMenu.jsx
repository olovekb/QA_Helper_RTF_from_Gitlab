import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './TaskActionsMenu.css';

/**
 * Контекстное меню
 * @param primaryButton - основная кнопка
 * @param children - пункты меню
 */
export default function TaskActionsMenu ({ primaryButton, children })
{
    const menuRef = useRef(null);
    const dropdownRef = useRef(null);
    const [menuOpen, setMenuOpen] = useState(null); // null | { top, left }

    useEffect(() =>
    {
        if (!menuOpen) return;
        const handleEscape = (e) =>
        {
            if (e.key === 'Escape') setMenuOpen(null);
        };
        const handleClickOutside = (e) =>
        {
            if (!menuRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target)) {
                setMenuOpen(null);
            }
        };
        const updatePosition = () =>
        {
            const rect = menuRef.current?.querySelector('.task-actions-trigger')?.getBoundingClientRect();
            if (rect) setMenuOpen({ top: rect.bottom + 4, left: rect.right + 4 });
        };
        let rafId = null;
        const handleScrollOrResize = () =>
        {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(updatePosition);
        };
        document.addEventListener('keydown', handleEscape);
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);
        return () =>
        {
            document.removeEventListener('keydown', handleEscape);
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [menuOpen]);

    const closeMenu = () => setMenuOpen(null);

    const items = React.Children.map(children, child =>
    {
        if (!React.isValidElement(child)) return child;
        const origOnClick = child.props.onClick;
        return React.cloneElement(child, {
            onClick: (e) =>
            {
                origOnClick?.(e);
                closeMenu();
            }
        });
    });

    return (
        <div className="task-create-row">
            { primaryButton }
            <div className="task-actions-menu-wrapper" ref={ menuRef }>
                <button
                    type="button"
                    className="btn btn-secondary task-actions-trigger"
                    onClick={ () =>
                    {
                        if (menuOpen) {
                            setMenuOpen(null);
                        } else {
                            const rect = menuRef.current?.querySelector('.task-actions-trigger')?.getBoundingClientRect();
                            if (rect) setMenuOpen({ top: rect.bottom + 4, left: rect.right + 4 });
                        }
                    } }
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                    </svg>
                </button>
                { menuOpen && createPortal(
                    <div
                        ref={ dropdownRef }
                        className="task-actions-dropdown"
                        style={ { position: 'fixed', top: menuOpen.top, left: menuOpen.left } }
                    >
                        { items }
                    </div>,
                    document.body
                ) }
            </div>
        </div>
    );
}
