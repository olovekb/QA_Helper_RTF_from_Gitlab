import React, { useState } from 'react';
import { useTIA } from '../context/TIAContext';
import { setupStyles } from '../styles/TIAStyles';
import TIAComponentCard from '../ui/TIAComponentCard';

const TIALeftMappingPanel = () => {
    const [isGlobalRisksExpanded, setIsGlobalRisksExpanded] = useState(false);
    const {
        components,
        tiaReport,
        selectedComponentType,
        setSelectedComponentType,
        selectedComponentId,
        setSelectedComponentId
    } = useTIA();

    if (!tiaReport) return null;

    const summary = tiaReport.summary || {};
    const filteredComponents = components.filter(comp => comp.type === selectedComponentType);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-content)' }}>
            {/* Статистика изменений */}
            <div style={{
                padding: '20px 24px',
                backgroundColor: 'var(--bg-input)',
                borderBottom: '1px solid var(--border-color)',
                boxShadow: 'var(--shadow-sm)'
            }}>
                <h3 style={{
                    margin: '0 0 12px 0',
                    fontSize: '16px',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                }}>
                    Анализ влияния
                </h3>
                <div style={{
                    display: 'flex',
                    gap: '16px',
                    flexWrap: 'wrap',
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--primary-accent)' }}></span>
                        <strong>Компонент:</strong> {components.filter(c => c.type === 'frontend').length + components.filter(c => c.type === 'backend').length}
                    </div>

                    {summary.test_coverage_percent !== undefined && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></span>
                            <strong>Покрытие:</strong> {summary.test_coverage_percent.toFixed(1)}%
                        </div>
                    )}

                    {summary.risk_counts && (
                        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                            <span style={{ color: 'var(--error)', fontWeight: 800 }}>H: {summary.risk_counts.HIGH || 0}</span>
                            <span style={{ color: 'var(--warning)', fontWeight: 800 }}>M: {summary.risk_counts.MEDIUM || 0}</span>
                            <span style={{ color: 'var(--success)', fontWeight: 800 }}>L: {summary.risk_counts.LOW || 0}</span>
                        </div>
                    )}
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', backgroundColor: 'var(--bg-content)' }}>
                {/* Глобальные риски */}
                {summary.global_risks?.length > 0 && (
                    <div style={{
                        padding: '16px 20px',
                        backgroundColor: 'var(--error-bg)',
                        border: '1px solid var(--error)',
                        borderRadius: '16px',
                        marginBottom: '24px',
                        boxShadow: '0 4px 12px color-mix(in srgb, var(--error) 10%, transparent)'
                    }}>
                        <div
                            onClick={() => setIsGlobalRisksExpanded(!isGlobalRisksExpanded)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                color: 'var(--error)',
                                fontWeight: 800,
                                fontSize: '13px',
                                cursor: 'pointer',
                                userSelect: 'none',
                                marginBottom: isGlobalRisksExpanded ? '12px' : '0'
                            }}
                        >
                            ГЛОБАЛЬНЫЕ РИСКИ ({summary.global_risks.length})
                            <span style={{
                                marginLeft: 'auto',
                                width: '8px',
                                height: '8px',
                                borderLeft: '2px solid var(--error)',
                                borderBottom: '2px solid var(--error)',
                                transition: 'transform 0.2s',
                                transform: isGlobalRisksExpanded ? 'rotate(-45deg)' : 'rotate(-135deg)',
                                marginBottom: isGlobalRisksExpanded ? '4px' : '2px'
                            }} />
                        </div>

                        {isGlobalRisksExpanded && summary.global_risks.map((risk, i) => (
                            <div key={i} style={{
                                fontSize: '12px',
                                color: 'var(--text-primary)',
                                marginTop: i > 0 ? '12px' : '0',
                                paddingTop: i > 0 ? '12px' : '0',
                                borderTop: i > 0 ? '1px solid color-mix(in srgb, var(--error) 20%, transparent)' : 'none'
                            }}>
                                <div style={{ fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>
                                    {risk.source} <span style={{ color: 'var(--error)' }}>[{risk.risk_level}]</span>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                    {risk.description}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ ...setupStyles.formGroup, marginBottom: '24px' }}>
                    <label style={setupStyles.label}>Тип компонентов</label>
                    <div style={setupStyles.modeToggleContainer}>
                        <button
                            onClick={() => setSelectedComponentType('frontend')}
                            style={setupStyles.modeToggleButton(selectedComponentType === 'frontend')}
                        >
                            Frontend ({components.filter(c => c.type === 'frontend').length})
                        </button>
                        <button
                            onClick={() => setSelectedComponentType('backend')}
                            style={setupStyles.modeToggleButton(selectedComponentType === 'backend')}
                        >
                            Backend ({components.filter(c => c.type === 'backend').length})
                        </button>
                    </div>
                </div>

                {filteredComponents.length === 0 ? (
                    <div style={{
                        padding: '40px 20px',
                        backgroundColor: 'var(--bg-input)',
                        borderRadius: '20px',
                        border: '1px dashed var(--border-color)',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        fontSize: '14px'
                    }}>
                        Нет затронутых компонентов этого типа
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {filteredComponents.map(comp => (
                            <TIAComponentCard
                                key={comp.id}
                                component={comp}
                                isSelected={selectedComponentId === comp.id}
                                onSelect={setSelectedComponentId}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TIALeftMappingPanel;
