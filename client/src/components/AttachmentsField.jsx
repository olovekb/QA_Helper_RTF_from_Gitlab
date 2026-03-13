import React, { useState, useCallback, useEffect } from 'react';
import { serializeFile } from './fileStorage';
import './AttachmentsField.css';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILE_COUNT = 20;

const isImageFile = (f) => {
  if (f.type?.startsWith?.('image/')) return true;
  if (f.dataUrl?.startsWith?.('data:image/')) return true;
  return false;
};

const formatFileSize = (bytes) => {
  if (bytes == null || typeof bytes !== 'number') return '';
  if (bytes < 1024) return ` (${bytes} B)`;
  if (bytes < 1024 * 1024) return ` (${(bytes / 1024).toFixed(1)} KB)`;
  return ` (${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
};

const getImageUrl = (f) => {
  if (f instanceof Blob) return URL.createObjectURL(f);
  if (f.dataUrl) return f.dataUrl;
  return null;
};

const removeRefFromText = (text, filename) =>
  (text || '').replace(
    new RegExp(`\\[([^\\]]+)\\|\\^${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][\\r\\n]*`, 'g'),
    ''
  ).trim();

function processFiles(rawFiles, existingCount, onExceedCount, onExceedSize) {
  let files = rawFiles;
  if (existingCount + files.length > MAX_FILE_COUNT) {
    onExceedCount(existingCount);
    files = files.slice(0, MAX_FILE_COUNT - existingCount);
  }
  const tooBig = files.filter(f => f.size > MAX_FILE_SIZE);
  if (tooBig.length) {
    onExceedSize(tooBig[0]);
    files = files.filter(f => f.size <= MAX_FILE_SIZE);
  }
  return files;
}

export default function AttachmentsField({
  task,
  index,
  onUpdate,
  setAttachmentsMap,
  attachmentsMap = {},
  commonOnly = true,
  label = 'Вложения',
  enableGlobalDrop = false,
}) {
  const [previewImage, setPreviewImage] = useState(null);

  const handleAttachmentClick = useCallback((f) => {
    if (!isImageFile(f)) return;
    const url = getImageUrl(f);
    if (url) setPreviewImage(url);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewImage(prev => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  useEffect(() => {
    if (previewImage && previewImage.startsWith('blob:')) {
      return () => URL.revokeObjectURL(previewImage);
    }
  }, [previewImage]);

  useEffect(() => {
    if (!previewImage) return;
    const onKey = (e) => { if (e.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewImage, closePreview]);

  const addFiles = useCallback(async (rawFiles) => {
    const existingCount = (task.attachments || []).length;
    const files = processFiles(
      rawFiles,
      existingCount,
      (count) => alert(`Нельзя прикрепить более ${MAX_FILE_COUNT} файлов (уже ${count}).`),
      (f) => alert(`Файл "${f.name}" слишком большой (${(f.size / 1024 / 1024).toFixed(1)} МБ). Максимум 50 МБ.`)
    );
    if (!files.length) return;
    onUpdate(index, { ...task, attachments: [...(task.attachments || []), ...files] });
    const serialized = await Promise.all(files.map(f => serializeFile(f)));
    setAttachmentsMap(m => ({
      ...m,
      [task.id]: {
        ...(m[task.id] || {}),
        common: [...(m[task.id]?.common || []), ...serialized],
      },
    }));
  }, [task, index, onUpdate, setAttachmentsMap]);

  useEffect(() => {
    if (!enableGlobalDrop) return;

    const handleWindowDragOver = (e) => {
      if (e.dataTransfer?.types?.includes?.('Files')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleWindowDrop = (e) => {
      if (e.dataTransfer?.files?.length) {
        e.preventDefault();
        e.stopPropagation();
        const droppedFiles = Array.from(e.dataTransfer.files || []);
        if (droppedFiles.length) addFiles(droppedFiles);
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [enableGlobalDrop, addFiles]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFiles = Array.from(e.dataTransfer?.files || []);
    if (droppedFiles.length) await addFiles(droppedFiles);
  }, [addFiles]);

  const handleFileInputChange = useCallback(async (e) => {
    const rawFiles = Array.from(e.target.files || []);
    if (rawFiles.length) await addFiles(rawFiles);
    e.target.value = '';
  }, [addFiles]);

  const removeAttachment = useCallback((f, source) => {
    if (source === 'common') {
      const newAttachments = task.attachments.filter((_, idx) => task.attachments[idx] !== f);
      onUpdate(index, { ...task, attachments: newAttachments });
      setAttachmentsMap(m => {
        const entry = m[task.id] || {};
        const newCommon = (entry.common || []).filter(x => x.name !== f.name);
        return { ...m, [task.id]: { ...entry, common: newCommon } };
      });
    } else {
      setAttachmentsMap(m => {
        const entry = m[task.id] || {};
        const newList = (entry[source] || []).filter(x => x.name !== f.name);
        return { ...m, [task.id]: { ...entry, [source]: newList } };
      });
      const fieldKey = source;
      const currentText = task[fieldKey] || '';
      const cleaned = removeRefFromText(currentText, f.name);
      onUpdate(index, {
        ...task,
        [fieldKey]: cleaned,
        [fieldKey + 'Attachments']: (task[fieldKey + 'Attachments'] || []).filter(x => x.name !== f.name),
      });
    }
  }, [task, index, onUpdate, setAttachmentsMap]);

  const common = (task.attachments || []).map(f => ({ f, source: 'common' }));
  const desc = (attachmentsMap[task.id]?.description || []).map(f => ({ f, source: 'description' }));
  const steps = (attachmentsMap[task.id]?.steps || []).map(f => ({ f, source: 'steps' }));
  const actual = (attachmentsMap[task.id]?.actual || []).map(f => ({ f, source: 'actual' }));
  const expected = (attachmentsMap[task.id]?.expected || []).map(f => ({ f, source: 'expected' }));
  const allItems = commonOnly ? common : [...common, ...desc, ...steps, ...actual, ...expected];

  return (
    <div className="field full-width attachments-field">
      <label>{label}</label>
      <div
        className="file-upload-zone"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          className="file-upload-input"
          onChange={handleFileInputChange}
        />
        <span className="file-upload-text">
          Перетащи или <span className="file-upload-accent">выбери</span> файлы
        </span>
      </div>
      {allItems.length > 0 && (
        <ul className="attached-list">
          {allItems.map(({ f, source }, i) => (
            <li key={`${source}-${f.name}-${i}`}>
              <span
                className={isImageFile(f) ? 'attached-file-name clickable' : 'attached-file-name'}
                onClick={() => handleAttachmentClick(f)}
                title={isImageFile(f) ? 'Нажмите для просмотра' : undefined}
              >
                {f.name}
                {formatFileSize(f.size) && (
                  <span className="attachment-size-badge">{formatFileSize(f.size)}</span>
                )}
              </span>
              <button
                type="button"
                className="remove-attachment-btn"
                onClick={() => removeAttachment(f, source)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {previewImage && (
        <div
          className="attachment-preview-overlay"
          onClick={closePreview}
          role="button"
          tabIndex={0}
        >
          <img src={previewImage} onClick={(e) => e.stopPropagation()} alt="" />
        </div>
      )}
    </div>
  );
}
