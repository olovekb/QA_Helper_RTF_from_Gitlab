// src/hooks/useAttachmentsMap.js
import { useState, useEffect, useRef } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { serializeFile, deserializeFile } from './fileStorage'

/**
 * Хук для хранения в IndexedDB
 * словаря вида { [taskId]: { common: File[], description: File[], ... } }
 */

export default function useAttachmentsMap(key, options = {}) {
    const { onSaved } = options
    const [map, setMap] = useState({})
    const onSavedRef = useRef(onSaved)
    onSavedRef.current = onSaved

    // 1) При монтировании: загрузить из IDB и десериализовать
    useEffect(() => {
        idbGet(key).then(raw => {
            if (!raw) return
            const restored = {}
            for (const [taskId, buckets] of Object.entries(raw)) {
                restored[taskId] = {}
                for (const section of ['common', 'description', 'steps', 'actual', 'expected']) {
                    restored[taskId][section] = (buckets[section] || [])
                        .map(obj => deserializeFile(obj))
                }
            }
            setMap(restored)
        }).catch(console.warn)
    }, [key])

    // 2) При любом изменении map: сериализовать и сохранить
    useEffect(() => {
        const toSave = {}
        const promises = []
        for (const [taskId, buckets] of Object.entries(map)) {
            toSave[taskId] = {}
            for (const section of ['common', 'description', 'steps', 'actual', 'expected']) {
                const files = buckets[section] || []
                toSave[taskId][section] = files.map(f => {
                    if (f.dataUrl) return f  // уже сериализован
                    const p = serializeFile(f).then(obj => obj)
                    promises.push(p)
                    return p
                })
            }
        }
        // дождёмся всех сериализаций, а потом сразу idbSet
        Promise.all(promises).then(resolved => {
            // заменяем все Promise на реальные объекты
            for (const taskId in toSave) {
                for (const section in toSave[taskId]) {
                    toSave[taskId][section] = toSave[taskId][section].map(x =>
                        x instanceof Promise ? resolved.shift() : x
                    )
                }
            }
            return idbSet(key, toSave).then(() => onSavedRef.current?.())
        }).catch(console.warn)
    }, [map, key])

    return [map, setMap]
}