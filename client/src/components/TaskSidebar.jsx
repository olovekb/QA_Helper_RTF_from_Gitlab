import React, { useState, useRef, useMemo, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

const truncate = (text, max = 100) =>
  text.length > max ? text.slice(0, max) + '…' : text;

export default function TaskSidebar ({
  tasks,
  setTasks,
  groups,
  setGroups,
  selectedTaskIndex,
  setSelectedTaskIndex,
  onAdd,
  onUpdate,
})
{
  const [dragIdx, setDragIdx] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const nameRef = useRef(null);

  const groupMap = useMemo(
    () => new Map(groups.map(g => [g.id, g])),
    [groups],
  );

  const sidebarItems = useMemo(() =>
  {
    const seen = new Set();
    const items = [];
    tasks.forEach((task, index) =>
    {
      const gid = task.groupId;
      if (gid && groupMap.has(gid)) {
        if (!seen.has(gid)) {
          seen.add(gid);
          const indices = [];
          tasks.forEach((t, i) => { if (t.groupId === gid) indices.push(i); });
          items.push({ type: 'group', group: groupMap.get(gid), indices });
        }
      } else {
        items.push({ type: 'task', index });
      }
    });
    return items;
  }, [tasks, groupMap]);

  const isDraggingGrouped = dragIdx !== null && tasks[dragIdx]?.groupId && groupMap.has(tasks[dragIdx].groupId);

  // drag-n-drop

  const onDragStart = useCallback((e, idx) =>
  {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDragEnd = useCallback(() =>
  {
    setDragIdx(null);
    setDropTarget(null);
  }, []);

  const dropOnTask = useCallback(targetIdx =>
  {
    if (dragIdx === null || dragIdx === targetIdx) { onDragEnd(); return; }
    const dragged = tasks[dragIdx];
    const target = tasks[targetIdx];
    const oldGid = dragged.groupId && groupMap.has(dragged.groupId) ? dragged.groupId : null;

    if (target.groupId && groupMap.has(target.groupId)) {
      const destGid = target.groupId;
      if (oldGid === destGid) { onDragEnd(); return; }

      const needDissolve = oldGid && tasks.filter((t, i) => i !== dragIdx && t.groupId === oldGid).length <= 1;

      setTasks(ts => ts.map((t, i) =>
      {
        if (i === dragIdx) return { ...t, groupId: destGid };
        if (needDissolve && t.groupId === oldGid) return { ...t, groupId: undefined };
        return t;
      }));
      if (needDissolve) setGroups(gs => gs.filter(g => g.id !== oldGid));
    } else {
      const newId = uuidv4();
      const needDissolve = oldGid && tasks.filter((t, i) => i !== dragIdx && t.groupId === oldGid).length <= 1;

      setGroups(gs =>
      {
        let next = [...gs, { id: newId, name: 'Новая группа', collapsed: false }];
        if (needDissolve) next = next.filter(g => g.id !== oldGid);
        return next;
      });
      setTasks(ts => ts.map((t, i) =>
      {
        if (i === dragIdx || i === targetIdx) return { ...t, groupId: newId };
        if (needDissolve && t.groupId === oldGid) return { ...t, groupId: undefined };
        return t;
      }));
    }
    onDragEnd();
  }, [dragIdx, tasks, groupMap, setTasks, setGroups, onDragEnd]);

  const dropOnGroup = useCallback(gid =>
  {
    if (dragIdx === null) { onDragEnd(); return; }
    if (tasks[dragIdx].groupId === gid) { onDragEnd(); return; }

    const oldGid = tasks[dragIdx].groupId && groupMap.has(tasks[dragIdx].groupId)
      ? tasks[dragIdx].groupId : null;
    const needDissolve = oldGid && tasks.filter((t, i) => i !== dragIdx && t.groupId === oldGid).length <= 1;

    setTasks(ts => ts.map((t, i) =>
    {
      if (i === dragIdx) return { ...t, groupId: gid };
      if (needDissolve && t.groupId === oldGid) return { ...t, groupId: undefined };
      return t;
    }));
    if (needDissolve) setGroups(gs => gs.filter(g => g.id !== oldGid));
    onDragEnd();
  }, [dragIdx, tasks, groupMap, setTasks, setGroups, onDragEnd]);

  const removeFromGroup = useCallback(taskIdx =>
  {
    const gid = tasks[taskIdx]?.groupId;
    if (!gid) return;
    const memberCount = tasks.filter(t => t.groupId === gid).length;

    if (memberCount <= 2) {
      setGroups(gs => gs.filter(g => g.id !== gid));
      setTasks(ts => ts.map(t => t.groupId === gid ? { ...t, groupId: undefined } : t));
    } else {
      setTasks(ts => ts.map((t, i) => i === taskIdx ? { ...t, groupId: undefined } : t));
    }
  }, [tasks, setTasks, setGroups]);

  // действия над группой

  const toggleGroupCheck = useCallback(indices =>
  {
    const allSel = indices.every(i => tasks[i]?.selected);
    setTasks(ts => ts.map((t, i) => indices.includes(i) ? { ...t, selected: !allSel } : t));
  }, [tasks, setTasks]);

  const toggleGroupCollapse = useCallback(gid =>
  {
    setGroups(gs => gs.map(g => g.id === gid ? { ...g, collapsed: !g.collapsed } : g));
  }, [setGroups]);

  const startEditing = useCallback(group =>
  {
    setEditingGroupId(group.id);
    setEditingName(group.name);
    setTimeout(() => nameRef.current?.focus(), 0);
  }, []);

  const saveGroupName = useCallback(() =>
  {
    if (!editingGroupId) return;
    setGroups(gs => gs.map(g =>
      g.id === editingGroupId ? { ...g, name: editingName.trim() || 'Без названия' } : g,
    ));
    setEditingGroupId(null);
  }, [editingGroupId, editingName, setGroups]);

  // удаление задачи из группы

  const handleUngroupDragOver = useCallback(e =>
  {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget({ type: 'ungroup' });
  }, []);

  const handleUngroupDrop = useCallback(e =>
  {
    e.preventDefault();
    e.stopPropagation();
    if (dragIdx !== null && tasks[dragIdx]?.groupId) {
      removeFromGroup(dragIdx);
      onDragEnd();
    }
  }, [dragIdx, tasks, removeFromGroup, onDragEnd]);

  // рендер задач

  const allSelected = tasks.length > 0 && tasks.every(t => t.selected);

  const renderTaskRow = (i, grouped = false) =>
  {
    const t = tasks[i];
    if (!t) return null;
    const isDragOver = dropTarget?.type === 'task' && dropTarget.index === i;
    const isDragging = dragIdx === i;

    return (
      <li
        key={ `t-${t.id || i}` }
        className={
          'task-sidebar-row' +
          (grouped ? ' task-sidebar-row--grouped' : '') +
          (isDragOver ? ' task-sidebar-row--drop-target' : '') +
          (isDragging ? ' task-sidebar-row--dragging' : '')
        }
        draggable
        onDragStart={ e => onDragStart(e, i) }
        onDragEnd={ onDragEnd }
        onDragOver={ e => { e.preventDefault(); e.stopPropagation(); if (dragIdx !== null && dragIdx !== i) setDropTarget({ type: 'task', index: i }); } }
        onDragLeave={ () => setDropTarget(null) }
        onDrop={ e => { e.preventDefault(); e.stopPropagation(); dropOnTask(i); } }
      >
        <label className="task-sidebar-checkbox-wrap">
          <input
            type="checkbox"
            checked={ !!t.selected }
            onChange={ e => { e.stopPropagation(); onUpdate(i, { ...t, selected: e.target.checked }); } }
            onClick={ e => e.stopPropagation() }
          />
        </label>
        <button
          className={ `task-sidebar-item${selectedTaskIndex === i ? ' active' : ''}` }
          onClick={ () => setSelectedTaskIndex(i) }
          title={ t.summary || 'Без темы' }
        >
          { truncate(t.summary || 'Без темы') }
        </button>
        <span className="task-sidebar-drag-handle" title="Перетащи для группировки">
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.2" />
            <circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="7" r="1.2" />
            <circle cx="6" cy="7" r="1.2" />
            <circle cx="2" cy="12" r="1.2" />
            <circle cx="6" cy="12" r="1.2" />
          </svg>
        </span>
      </li>
    );
  };


  const selectedTask = tasks[selectedTaskIndex];
  const activeGroupId = groups.length >= 2 && selectedTask?.groupId && groupMap.has(selectedTask.groupId)
    ? selectedTask.groupId : undefined;

  return (
    <aside className="task-sidebar">
      <div className="task-sidebar-header">
        <button type="button" className="btn btn-secondary btn-sm" onClick={ () => onAdd(activeGroupId) }>
          Добавить задачу
        </button>
        <button
          type="button"
          className="btn-link"
          onClick={ () => setTasks(ts => ts.map(t => ({ ...t, selected: !allSelected }))) }
        >
          { allSelected ? 'Снять выбор' : 'Выбрать все' }
        </button>
      </div>

      <ul className="task-sidebar-list">
        { sidebarItems.map(item =>
        {
          if (item.type === 'group') {
            const { group, indices } = item;
            const groupAllSel = indices.length > 0 && indices.every(i => tasks[i]?.selected);
            const isGroupDrop = dropTarget?.type === 'group' && dropTarget.groupId === group.id;

            return (
              <li
                key={ `g-${group.id}` }
                className={ 'task-sidebar-group' + (isGroupDrop ? ' task-sidebar-group--drop-target' : '') }
              >
                <div
                  className="task-sidebar-group-header"
                  onDragOver={ e => { e.preventDefault(); e.stopPropagation(); setDropTarget({ type: 'group', groupId: group.id }); } }
                  onDragLeave={ () => setDropTarget(null) }
                  onDrop={ e => { e.preventDefault(); e.stopPropagation(); dropOnGroup(group.id); } }
                >
                  <label className="task-sidebar-checkbox-wrap">
                    <input
                      type="checkbox"
                      checked={ groupAllSel }
                      onChange={ () => toggleGroupCheck(indices) }
                      onClick={ e => e.stopPropagation() }
                    />
                  </label>
                  <button
                    className="task-sidebar-group-toggle"
                    onClick={ () => toggleGroupCollapse(group.id) }
                  >
                    <svg
                      className={ 'collapse-toggle-icon' + (group.collapsed ? ' collapsed' : '') }
                      width="12" height="12" viewBox="0 0 10 10"
                      fill="none" stroke="currentColor" strokeWidth="1.5"
                    >
                      <path d="M2 3l3 4 3-4" />
                    </svg>
                  </button>
                  { editingGroupId === group.id ? (
                    <input
                      ref={ nameRef }
                      className="task-sidebar-group-name-input"
                      value={ editingName }
                      onChange={ e => setEditingName(e.target.value) }
                      onBlur={ saveGroupName }
                      onKeyDown={ e =>
                      {
                        if (e.key === 'Enter') { e.preventDefault(); saveGroupName(); }
                        if (e.key === 'Escape') setEditingGroupId(null);
                      } }
                    />
                  ) : (
                    <span
                      className="task-sidebar-group-name"
                      onDoubleClick={ () => startEditing(group) }
                    >
                      { group.name }
                      <span className="task-sidebar-group-count">{ indices.length }</span>
                    </span>
                  ) }
                </div>
                { !group.collapsed && (
                  <ul className="task-sidebar-group-items">
                    { indices.map(i => renderTaskRow(i, true)) }
                  </ul>
                ) }
              </li>
            );
          }
          return renderTaskRow(item.index);
        }) }

      </ul>

      { isDraggingGrouped && (
        <div
          className={ 'task-sidebar-ungroup-zone' + (dropTarget?.type === 'ungroup' ? ' task-sidebar-ungroup-zone--active' : '') }
          onDragOver={ handleUngroupDragOver }
          onDragLeave={ () => setDropTarget(null) }
          onDrop={ handleUngroupDrop }
        >
          Убрать из группы
        </div>
      ) }
    </aside>
  );
}
