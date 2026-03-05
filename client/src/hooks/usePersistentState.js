import { useState, useEffect, useRef } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';

const TASK_STRIP_FIELDS = {
  solutionTasks: ['attachments', 'requirementAttachments', 'descriptionAttachments', 'stepsAttachments', 'actualAttachments', 'expectedAttachments'],
  codeErrorTasks: ['attachments', 'descriptionAttachments', 'stepsAttachments', 'actualAttachments', 'expectedAttachments']
};

export function usePersistentState (key, defaultValue, onSaved)
{
  const [state, setState] = useState(defaultValue);
  const isFirstMount = useRef(true);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() =>
  {
    idbGet(key)
      .then(stored =>
      {
        if (stored !== undefined) {
          setState(stored);
        } else {
          idbSet(key, defaultValue).catch(console.warn);
        }
      })
      .catch(console.warn);
  }, [key]);

  useEffect(() =>
  {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const stripFields = TASK_STRIP_FIELDS[key];
    const toSave = stripFields && Array.isArray(state)
      ? state.map(t =>
        {
          const rest = { ...t };
          stripFields.forEach(f => delete rest[f]);
          return rest;
        })
      : state;

    idbSet(key, toSave)
      .then(() => onSavedRef.current?.())
      .catch(err => console.warn(`IDB error saving "${key}":`, err));
  }, [key, state]);

  return [state, setState];
}
