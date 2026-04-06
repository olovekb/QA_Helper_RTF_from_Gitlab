import React from 'react';
import { useTIA } from '../context/TIAContext';
import { styles } from '../styles/TIAStyles';

/**
 * Компонент ввода ссылки на задачу в Jira
 * @returns {JSX.Element}
 */
const TIAJiraLink = () => {
    const { jiraLink, handleJiraLinkChange } = useTIA();

    return (
        <div style={styles.formGroup}>
            <label style={styles.label}>Ссылка на Jira (или ключ задачи)</label>
            <input
                type="text"
                style={{
                    ...styles.select,
                    padding: '14px 16px',
                    borderColor: jiraLink ? 'var(--primary-accent)' : 'var(--border-color)',
                }}
                placeholder="Например: https://jira.ru/browse/TASK-123 или TASK-123"
                value={jiraLink}
                onChange={handleJiraLinkChange}
            />
        </div>
    );
};

export default TIAJiraLink;
