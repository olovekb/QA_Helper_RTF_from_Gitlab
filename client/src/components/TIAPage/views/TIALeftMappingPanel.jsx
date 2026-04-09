import React, { useState } from 'react';
import { useTIA } from '../context/TIAContext';
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
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/*  */}
            <div style={{
                padding: '12px 16px',
                backgroundColor: '#ffffff',
                borderBottom: '1px solid #e2e8f0',
                boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
            }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>Что затронуто</h3>
                <div style={{
                    display: 'flex',
                    gap: '12px',
                    flexWrap: 'wrap',
                    fontSize: '12px',
                    color: '#6c757d',
                    alignItems: 'center'
                }}>
                    <span>
                        <strong style={{ color: '#111' }}>Фронтенд компонентов:</strong> {components.filter(c => c.type === 'frontend').length}
                    </span>

                    {summary.test_coverage_percent !== undefined && (
                        <>
                            <span>•</span>
                            <span>
                                <strong>Coverage:</strong> {summary.test_coverage_percent.toFixed(1)}%
                            </span>
                        </>
                    )}

                    {summary.risk_counts && (
                        <>
                            <span>•</span>
                            <span>
                                <strong style={{ color: '#dc3545' }}>HIGH:</strong> {summary.risk_counts.HIGH || 0}
                            </span>
                            <span>•</span>
                            <span>
                                <strong style={{ color: '#ffc107' }}>MEDIUM:</strong> {summary.risk_counts.MEDIUM || 0}
                            </span>
                            <span>•</span>
                            <span>
                                <strong style={{ color: '#28a745' }}>LOW:</strong> {summary.risk_counts.LOW || 0}
                            </span>
                        </>
                    )}
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', backgroundColor: '#f8fafc' }}>
                {/* */}
                {summary.global_risks?.length > 0 && (
                    <div style={{
                        padding: '14px',
                        backgroundColor: '#fff5f5',
                        border: '2px solid #dc3545',
                        borderRadius: '12px',
                        marginBottom: '20px',
                        boxShadow: '0 4px 12px rgba(220, 53, 69, 0.08)'
                    }}>
                        <div
                            onClick={() => setIsGlobalRisksExpanded(!isGlobalRisksExpanded)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                color: '#dc3545',
                                fontWeight: 700,
                                fontSize: '13px',
                                cursor: 'pointer',
                                userSelect: 'none',
                                marginBottom: isGlobalRisksExpanded ? '10px' : '0'
                            }}
                        >
                            Глобальные риски: {summary.global_risks.length}
                            <span style={{
                                marginLeft: 'auto',
                                transition: 'transform 0.2s',
                                transform: isGlobalRisksExpanded ? 'rotate(0deg)' : 'rotate(-90deg)'
                            }}>
                                ▼
                            </span>
                        </div>

                        {isGlobalRisksExpanded && summary.global_risks.map((risk, i) => (
                            <div key={i} style={{
                                fontSize: '12px',
                                color: '#111',
                                marginTop: i > 0 ? '10px' : '0',
                                paddingTop: i > 0 ? '10px' : '0',
                                borderTop: i > 0 ? '1px solid #fecaca' : 'none'
                            }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                                    {risk.source} <span style={{ color: '#dc3545' }}>({risk.risk_level})</span>
                                </div>
                                <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
                                    {risk.description}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* */}
                <div style={{
                    display: 'flex',
                    gap: '4px',
                    marginBottom: '16px',
                    borderBottom: '2px solid #e2e8f0',
                    paddingBottom: '0'
                }}>
                    <button
                        onClick={() => setSelectedComponentType('frontend')}
                        style={{
                            padding: '10px 16px',
                            fontSize: '13px',
                            fontWeight: 700,
                            color: selectedComponentType === 'frontend' ? '#3b82f6' : '#64748b',
                            backgroundColor: 'transparent',
                            border: 'none',
                            borderBottom: selectedComponentType === 'frontend' ? '3px solid #3b82f6' : '3px solid transparent',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            marginBottom: '-2px'
                        }}
                    >
                        Фронтенд ({components.filter(c => c.type === 'frontend').length})
                    </button>
                    <button
                        onClick={() => setSelectedComponentType('backend')}
                        style={{
                            padding: '10px 16px',
                            fontSize: '13px',
                            fontWeight: 700,
                            color: selectedComponentType === 'backend' ? '#3b82f6' : '#64748b',
                            backgroundColor: 'transparent',
                            border: 'none',
                            borderBottom: selectedComponentType === 'backend' ? '3px solid #3b82f6' : '3px solid transparent',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            marginBottom: '-2px'
                        }}
                    >
                        Бэкенд ({components.filter(c => c.type === 'backend').length})
                    </button>
                </div>

                {filteredComponents.length === 0 ? (
                    <div style={{
                        padding: '24px',
                        backgroundColor: '#ffffff',
                        borderRadius: '16px',
                        border: '1px solid #e2e8f0',
                        textAlign: 'center',
                        color: '#64748b'
                    }}>
                        Компоненты не найдены
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
