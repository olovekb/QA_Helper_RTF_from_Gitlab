/**
 * обработчик onChange для полей задачи
 * @param task - текущий объект залачи
 * @param index - индекс задачи в массиве
 * @param onUpdate - колбэк
 * 
 * @example createHandleChange(task, i, onUpdate)('summary')(e) — обновить поле summary
 */
export const createHandleChange = (task, index, onUpdate) => (field) => (e) =>
{
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  onUpdate(index, { ...task, [field]: v });
};

/**
 * обработчик onPaste для вставки файлов из буфера обмена, переименовывает файл 
 * в screenshot-{timestamp}-{index}, вставляет разметку [name|^name] в текст поля и сохраняет аттач в attachmentsMap
 *
 * @param task - текущий объект задачи
 * @param index - индекс задачи в массиве
 * @param onUpdate - колбэк (index, updatedTask) => void
 * @param setAttachmentsMap - сеттер карты вложений
 * @param [options.includeCommon]  - сохранять ли файлы в common-секцию (по дефолту false)
 */
export const createHandlePaste = (task, index, onUpdate, setAttachmentsMap, options = {}) =>
{
  const { serializeFile: serializeFn, includeCommon = false } = options;

  return (field) => async (e) =>
  {
    const rawFiles = Array.from(e.clipboardData?.files || []);
    if (!rawFiles.length) return;
    e.preventDefault();

    const renamedFiles = rawFiles.map((f, idx) =>
    {
      const ext = f.name.split('.').pop();
      return new File([f], `screenshot-${Date.now()}-${idx}.${ext}`, { type: f.type });
    });

    const placeholders = renamedFiles.map(f => `[${f.name}|^${f.name}]`).join('\n');
    const existingText = task[field] || '';
    const needsSeparator = existingText !== '' && !existingText.endsWith('\n');
    const markup = (needsSeparator ? '\n' : '') + placeholders;
    const attKey = field + 'Attachments';
    const prevList = task[attKey] || [];

    onUpdate(index, {
      ...task,
      [field]: existingText + markup,
      [attKey]: [...prevList, ...renamedFiles]
    });

    if (includeCommon && serializeFn) {
      const serialized = await Promise.all(renamedFiles.map(f => serializeFn(f)));
      setAttachmentsMap(m => ({
        ...m,
        [task.id]: {
          ...(m[task.id] || {}),
          common: [...(m[task.id]?.common || []), ...serialized],
          [field]: [...(m[task.id]?.[field] || []), ...renamedFiles]
        }
      }));
    } else {
      setAttachmentsMap(m => ({
        ...m,
        [task.id]: {
          ...(m[task.id] || {}),
          [field]: [...(m[task.id]?.[field] || []), ...renamedFiles]
        }
      }));
    }
  };
};
