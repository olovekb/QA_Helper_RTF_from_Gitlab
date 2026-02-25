/**
 * Отправляет событие на сервер для передачи в вебхук google-таблицы
 */
import config from './config';

const STORAGE_KEY = 'qa_helper_client_id';

function getClientId ()
{
    if (typeof window === 'undefined') return '';
    const h = window.location?.hostname || '';
    if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.')) return 'dev';
    try {
        let id = localStorage.getItem(STORAGE_KEY);
        if (!id) {
            id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            localStorage.setItem(STORAGE_KEY, id);
        }
        return id;
    } catch {
        return '';
    }
}

/**
 * @param {string} action - алиас действия
 * @param {Object} [ctx] - объект контекста события
 * @param {string} [ctx.page] - страница (pathname)
 * @param {string} [ctx.projectId] - ID проекта в ТестОпс
 * @param {string} [ctx.taskId] - ID задачи в Jira или другой идентификатор (ID страницы в Confluence)
 * @param {Object} [ctx.extra] - дополнительные данные
 */
export function trackEvent (action, ctx = {})
{
    const page = ctx.page ?? (typeof window !== 'undefined' ? window.location?.pathname || '' : '');
    const payload = {
        action,
        page,
        clientId: getClientId(),
        projectId: ctx.projectId ?? '',
        taskId: ctx.taskId ?? '',
        extra: ctx.extra ?? null
    };

    const url = `${config.serverUrl}/analytics/event`;
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
    }).catch(() => { });
}
