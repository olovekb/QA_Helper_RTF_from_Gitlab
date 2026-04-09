import React from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { useTIA } from '../context/TIAContext';
import { styles } from '../styles/TIAStyles';
import Loader from '../../../Loader';
import { findFolderById, formatCustomFieldName } from '../utils/tiaUtils';
import TIASplitFolderTree from './TIASplitFolderTree';

/**
 * Модальное окно для разделения функциональных блоков на несколько параллельных запусков Allure
 * @returns {JSX.Element|null}
 */
const TIASplitModal = () => {
    const {
        showSplitModal,
        handleSplitModalCancel,
        launchGroups,
        setLaunchGroups,
        unassignedFolderIds,
        onDragEnd,
        folders,
        handleMappingConfirm,
        loadingState,
        splitProgress
    } = useTIA();

    if (!showSplitModal) return null;

    /**
     * Создание новой группы запуска
     */
    const addNewGroup = () => {
        const newId = Date.now();
        setLaunchGroups(prev => [...prev, {
            id: newId,
            name: `Запуск ${prev.length + 1}`,
            folderIds: [],
            jiraLink: ''
        }]);
    };

    /**
     * Удаление группы
     */
    const removeGroup = (id) => {
        setLaunchGroups(prev => prev.filter(g => g.id !== id));
    };

    /**
     * Обновление поля группы
     */
    const updateGroup = (id, field, value) => {
        setLaunchGroups(prev => prev.map(g => g.id === id ? { ...g, [field]: value } : g));
    };

    const assignedCount = launchGroups.reduce((sum, g) => sum + (g.folderIds?.length || 0), 0);
    const activeGroupsCount = launchGroups.filter(g => g.folderIds.length > 0).length;

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '40px'
        }}>
            <div style={{
                backgroundColor: 'var(--bg-content)',
                width: '100%',
                maxWidth: '1400px',
                height: '90vh',
                borderRadius: '32px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid var(--border-color)',
                overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{ padding: '32px 40px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                            Разделение на запуски
                        </h3>
                        <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '8px 0 0 0' }}>
                            Перетащите функциональные блоки в соответствующие группы для создания нескольких запусков тестирования.
                        </p>
                    </div>
                    <button onClick={handleSplitModalCancel} style={{ background: 'none', border: 'none', fontSize: '24px', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
                </div>

                <DragDropContext onDragEnd={onDragEnd}>
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        {/* Доступные блоки */}
                        <div style={{
                            width: '400px',
                            borderRight: '1px solid var(--border-color)',
                            display: 'flex',
                            flexDirection: 'column',
                            backgroundColor: 'var(--bg-input)'
                        }}>
                            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border-color)' }}>
                                <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    ДОСТУПНЫЕ БЛОКИ ({unassignedFolderIds.length})
                                </div>
                            </div>
                            <Droppable droppableId="unassigned-pool">
                                {(provided, snapshot) => (
                                    <div
                                        {...provided.droppableProps}
                                        ref={provided.innerRef}
                                        style={{
                                            flex: 1,
                                            overflowY: 'auto',
                                            padding: '20px 32px',
                                            backgroundColor: snapshot.isDraggingOver ? 'rgba(99, 102, 241, 0.05)' : 'transparent'
                                        }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <TIASplitFolderTree
                                                folders={folders}
                                                unassignedIds={unassignedFolderIds}
                                            />
                                            {provided.placeholder}
                                        </div>
                                    </div>
                                )}
                            </Droppable>
                        </div>

                        {/* Группы запусков*/}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-content)' }}>
                            <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '24px' }}>
                                    {launchGroups.map((group) => (
                                        <div key={group.id} style={{
                                            backgroundColor: '#fff',
                                            borderRadius: '24px',
                                            padding: '24px',
                                            border: '1px solid var(--border-color)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                                            height: '520px',
                                            minWidth: '400px',
                                            maxWidth: '500px'
                                        }}>
                                            <div style={{ flexShrink: 0 }}>
                                                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
                                                    <input
                                                        type="text"
                                                        value={group.name}
                                                        onChange={(e) => updateGroup(group.id, 'name', e.target.value)}
                                                        placeholder="Название запуска"
                                                        style={{
                                                            flex: 1,
                                                            height: '44px',
                                                            border: '1px solid var(--border-color)',
                                                            borderRadius: '12px',
                                                            padding: '0 16px',
                                                            fontSize: '15px',
                                                            fontWeight: 700,
                                                            backgroundColor: 'var(--bg-input)',
                                                            outline: 'none',
                                                            color: 'var(--text-primary)'
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => removeGroup(group.id)}
                                                        style={{
                                                            width: '44px',
                                                            height: '44px',
                                                            borderRadius: '12px',
                                                            border: 'none',
                                                            backgroundColor: '#fee2e2',
                                                            color: '#ef4444',
                                                            fontSize: '18px',
                                                            fontWeight: 800,
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            transition: 'all 0.2s',
                                                            marginTop: '0px'
                                                        }}
                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fecaca'}
                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fee2e2'}
                                                    >
                                                        ✕
                                                    </button>
                                                </div>

                                                {/* Link to Jira */}
                                                <div style={{ marginBottom: '16px' }}>
                                                    <input
                                                        type="text"
                                                        value={group.jiraLink || ''}
                                                        onChange={(e) => updateGroup(group.id, 'jiraLink', e.target.value)}
                                                        placeholder="Ссылка на Jira (опционально)"
                                                        style={{
                                                            width: '100%',
                                                            border: '1px solid var(--border-color)',
                                                            borderRadius: '10px',
                                                            padding: '8px 12px',
                                                            fontSize: '12px',
                                                            backgroundColor: 'var(--bg-input)'
                                                        }}
                                                    />
                                                </div>
                                            </div>

                                            <Droppable droppableId={`launch-${group.id}`}>
                                                {(provided, snapshot) => (
                                                    <div
                                                        {...provided.droppableProps}
                                                        ref={provided.innerRef}
                                                        style={{
                                                            flex: 1,
                                                            minHeight: 0,
                                                            overflowY: 'auto',
                                                            backgroundColor: snapshot.isDraggingOver ? 'rgba(99, 102, 241, 0.03)' : 'var(--bg-input)',
                                                            borderRadius: '16px',
                                                            padding: '12px',
                                                            border: `2px dashed ${snapshot.isDraggingOver ? 'var(--primary-accent)' : 'var(--border-color)'}`,
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '8px'
                                                        }}
                                                    >
                                                        {group.folderIds.map((id, index) => {
                                                            const folder = findFolderById(folders || [], id);
                                                            if (!folder) return null;
                                                            return (
                                                                <Draggable key={id.toString()} draggableId={`folder-${id}`} index={index}>
                                                                    {(provided, snapshot) => (
                                                                        <div
                                                                            ref={provided.innerRef}
                                                                            {...provided.draggableProps}
                                                                            {...provided.dragHandleProps}
                                                                            style={{
                                                                                ...provided.draggableProps.style,
                                                                                padding: '10px 14px',
                                                                                backgroundColor: 'var(--bg-content)',
                                                                                color: 'var(--text-primary)',
                                                                                borderRadius: '12px',
                                                                                border: '1px solid var(--border-color)',
                                                                                boxShadow: snapshot.isDragging ? '0 10px 15px -3px rgba(0, 0, 0, 0.1)' : '0 1px 2px rgba(0,0,0,0.02)',
                                                                                fontSize: '12px',
                                                                                fontWeight: 700,
                                                                                lineHeight: '1.2',
                                                                                whiteSpace: 'nowrap',
                                                                                overflow: 'hidden',
                                                                                textOverflow: 'ellipsis',
                                                                                minHeight: '44px',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                justifyContent: 'flex-start',
                                                                                padding: '0 16px',
                                                                                flexShrink: 0,
                                                                                width: '100%',
                                                                                boxSizing: 'border-box'
                                                                            }}
                                                                            title={formatCustomFieldName(folder)}
                                                                        >
                                                                            {formatCustomFieldName(folder)}
                                                                        </div>
                                                                    )}
                                                                </Draggable>
                                                            );
                                                        })}
                                                        {provided.placeholder}
                                                    </div>
                                                )}
                                            </Droppable>
                                        </div>
                                    ))}
                                    <div
                                        onClick={addNewGroup}
                                        style={{
                                            border: '2px dashed var(--border-color)',
                                            borderRadius: '24px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            minHeight: '300px',
                                            transition: 'all 0.2s',
                                            backgroundColor: 'rgba(0,0,0,0.02)',
                                            gap: '12px'
                                        }}
                                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary-accent)'; e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.05)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.02)'; }}
                                    >
                                        <span style={{ fontSize: '40px', color: 'var(--text-muted)' }}>+</span>
                                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-muted)' }}>Добавить запуск</span>
                                    </div>
                                </div>
                            </div>

                            {/* Footer Area */}
                            <div style={{
                                padding: '32px 40px',
                                borderTop: '1px solid var(--border-color)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                backgroundColor: 'var(--bg-input)'
                            }}>
                                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-muted)' }}>
                                    Назначено: {assignedCount} блоков • Без назначения: {unassignedFolderIds.length}
                                </div>
                                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                    {splitProgress && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginRight: '20px' }}>
                                            <div style={{ width: '150px', height: '8px', backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                                                <div style={{ width: `${(splitProgress.current / splitProgress.total) * 100}%`, height: '100%', backgroundColor: 'var(--success)', transition: 'width 0.3s ease' }} />
                                            </div>
                                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>
                                                {splitProgress.current}/{splitProgress.total}
                                            </span>
                                        </div>
                                    )}
                                    <button
                                        onClick={handleSplitModalCancel}
                                        style={{
                                            ...styles.backButton,
                                            padding: '14px 32px',
                                            height: 'auto',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            margin: 0
                                        }}
                                    >
                                        Отмена
                                    </button>
                                    <button
                                        onClick={() => handleMappingConfirm('split')}
                                        disabled={loadingState.launch || activeGroupsCount === 0}
                                        style={{
                                            ...styles.primaryButton,
                                            margin: 0,
                                            padding: '14px 32px',
                                            height: 'auto',
                                            opacity: (loadingState.launch || activeGroupsCount === 0) ? 0.6 : 1,
                                            cursor: (loadingState.launch || activeGroupsCount === 0) ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        {loadingState.launch ? (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                                <Loader size="18px" color="#fff" />
                                                <span>Создание ({splitProgress?.current}/{splitProgress?.total})...</span>
                                            </div>
                                        ) : (
                                            `Создать ${activeGroupsCount} запуск${activeGroupsCount === 1 ? '' : activeGroupsCount > 1 && activeGroupsCount < 5 ? 'а' : 'ов'}`
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </DragDropContext>
            </div>
        </div>
    );
};

export default TIASplitModal;
