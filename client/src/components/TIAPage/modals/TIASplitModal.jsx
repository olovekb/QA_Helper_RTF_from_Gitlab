import React from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { useTIA } from '../context/TIAContext';
import { styles } from '../styles/TIAStyles';
import Loader from '../../../Loader';
import { findFolderById } from '../utils/tiaUtils';

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
        const newId = `launch-${Date.now()}`;
        setLaunchGroups(prev => [...prev, { id: newId, name: `Запуск ${prev.length + 1}`, folderIds: [], jiraLink: '' }]);
    };

    return (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ backgroundColor: 'var(--bg-content)', width: '100%', maxWidth: '1200px', maxHeight: '90vh', borderRadius: '32px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                {/* Header */}
                <div style={{ padding: '32px 40px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(to right, var(--bg-content), var(--bg-input))', borderRadius: '32px 32px 0 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <h3 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            Разделение на запуски
                        </h3>
                        <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                            Перетащите функциональные блоки в соответствующие группы для параллельного тестирования.
                        </p>
                    </div>
                </div>

                {/* Drag and Drop Area */}
                <DragDropContext onDragEnd={onDragEnd}>
                    <div style={{ display: 'flex', flex: 1, padding: '20px', gap: '20px', overflow: 'hidden' }}>
                        {/* Unassigned Pool */}
                        <div style={{ flex: '0 0 350px', backgroundColor: 'var(--bg-input)', borderRadius: '24px', padding: '20px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)' }}>
                            <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Доступные блоки ({unassignedFolderIds.length})
                            </h4>
                            <Droppable droppableId="unassigned-pool">
                                {(provided) => (
                                    <div 
                                        {...provided.droppableProps} 
                                        ref={provided.innerRef} 
                                        style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {unassignedFolderIds.map((id, index) => {
                                                const folder = findFolderById(folders || [], id);
                                                if (!folder) return null;
                                                return (
                                                    <Draggable key={id} draggableId={`pool::${id}`} index={index}>
                                                        {(provided, snapshot) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                style={{
                                                                    ...provided.draggableProps.style,
                                                                    padding: '12px 16px',
                                                                    backgroundColor: snapshot.isDragging ? 'var(--primary-accent)' : 'var(--bg-content)',
                                                                    color: snapshot.isDragging ? '#fff' : 'var(--text-primary)',
                                                                    borderRadius: '12px',
                                                                    border: snapshot.isDragging ? 'none' : '1px solid var(--border-color)',
                                                                    boxShadow: snapshot.isDragging ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
                                                                    fontSize: '13px',
                                                                    fontWeight: 500,
                                                                }}
                                                            >
                                                                {folder.name}
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                );
                                            })}
                                            {provided.placeholder}
                                        </div>
                                    </div>
                                )}
                            </Droppable>
                        </div>

                        {/* Launch Groups */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', flex: 1, overflowY: 'auto', padding: '4px' }}>
                                {launchGroups.map((group) => (
                                    <div key={group.id} style={{ backgroundColor: 'var(--bg-content)', borderRadius: '24px', padding: '16px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-sm)', minHeight: '200px' }}>
                                        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                            <input 
                                                type="text" 
                                                value={group.name} 
                                                onChange={(e) => setLaunchGroups(prev => prev.map(g => g.id === group.id ? { ...g, name: e.target.value } : g))}
                                                placeholder="Название запуска"
                                                style={{ ...styles.select, padding: '10px 14px', flex: 1, fontWeight: 700 }}
                                            />
                                            <button 
                                                onClick={() => setLaunchGroups(prev => prev.filter(g => g.id !== group.id))}
                                                style={{ padding: '8px 12px', borderRadius: '12px', border: 'none', backgroundColor: '#fee2e2', color: '#ef4444', fontWeight: 700, cursor: 'pointer' }}
                                            >
                                                ×
                                            </button>
                                        </div>

                                        <Droppable droppableId={`launch-${group.id}`}>
                                            {(provided, snapshot) => (
                                                <div 
                                                    {...provided.droppableProps} 
                                                    ref={provided.innerRef} 
                                                    style={{ 
                                                        flex: 1, 
                                                        minHeight: '100px', 
                                                        backgroundColor: snapshot.isDraggingOver ? 'color-mix(in srgb, var(--primary-accent) 5%, transparent)' : 'var(--bg-input)', 
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
                                                            <Draggable key={id} draggableId={`launch-${group.id}::${id}`} index={index}>
                                                                {(provided, snapshot) => (
                                                                    <div
                                                                        ref={provided.innerRef}
                                                                        {...provided.draggableProps}
                                                                        {...provided.dragHandleProps}
                                                                        style={{
                                                                            ...provided.draggableProps.style,
                                                                            padding: '10px 14px',
                                                                            backgroundColor: 'var(--bg-content)',
                                                                            borderRadius: '10px',
                                                                            border: '1px solid var(--border-color)',
                                                                            boxShadow: snapshot.isDragging ? 'var(--shadow-lg)' : 'none',
                                                                            fontSize: '12px',
                                                                            fontWeight: 500,
                                                                        }}
                                                                    >
                                                                        {folder.name}
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
                                    style={{ border: '2px dashed var(--border-color)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', minHeight: '150px', transition: 'all 0.2s', '&:hover': { borderColor: 'var(--primary-accent)', backgroundColor: 'var(--bg-input)' } }}
                                >
                                    <span style={{ fontSize: '32px', color: 'var(--text-muted)' }}>+</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </DragDropContext>

                {/* Footer and Progress */}
                <div style={{ padding: '32px 40px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '24px', borderRadius: '0 0 32px 32px' }}>
                    {splitProgress && (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--bg-input)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ width: `${(splitProgress.current / splitProgress.total) * 100}%`, height: '100%', backgroundColor: 'var(--success)', transition: 'width 0.3s ease' }} />
                            </div>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>
                                {splitProgress.launchName} ({splitProgress.current}/{splitProgress.total})
                            </span>
                        </div>
                    )}
                    <button onClick={handleSplitModalCancel} style={styles.modalButtonCancel}>
                        Отмена
                    </button>
                    <button 
                        onClick={() => handleMappingConfirm('split')} 
                        disabled={loadingState.launch || launchGroups.every(g => g.folderIds.length === 0)}
                        style={{ ...styles.modalButtonConfirm, opacity: (loadingState.launch || launchGroups.every(g => g.folderIds.length === 0)) ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        {loadingState.launch && <Loader size="16px" color="#fff" />}
                        Создать все запуски
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TIASplitModal;
