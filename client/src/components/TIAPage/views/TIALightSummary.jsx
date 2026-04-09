import React, { useState } from 'react';
import { useTIA } from '../context/TIAContext';
import { styles } from '../styles/TIAStyles';

/**
 * Компонент сводной информации для режима "Лайт".
 */
const TIALightSummary = () => {
    const {
        tiaReport,
        mode
    } = useTIA();

    const [expandedPageComponents, setExpandedPageComponents] = useState({});

    const isNewTiaFormat = (report) => report && (report.summary || report.pages);

    if (!tiaReport || !isNewTiaFormat(tiaReport) || mode !== 'light') return null;

    const { summary, pages } = tiaReport;
    const globalRisks = summary?.global_risks || [];

    const renderQAAdvice = (qaAdvice = []) => {
        if (!qaAdvice.length) return null;
        return qaAdvice.map((advice, idx) => (
            <div key={`qa-${idx}`} style={{ padding: '8px 0', color: '#111' }}>
                <div style={{ fontWeight: 600, color: '#111' }}>{advice.area} — {advice.priority}</div>
                {(advice.scenarios || []).map((scenario, i) => (
                    <div key={`scenario-${idx}-${i}`} style={{ fontSize: 14, marginTop: 4, color: '#111' }}>{scenario}</div>
                ))}
            </div>
        ));
    };

    return (
        <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '4px', height: '24px', backgroundColor: '#6366f1', borderRadius: '2px' }} />
                <h2 style={{ ...styles.title }}>Сводка изменений</h2>
            </div>

            {/* Глобальные риски - красный алерт блок */}
            {Array.isArray(globalRisks) && globalRisks.length > 0 && (
                <div style={{
                    marginBottom: 32,
                    padding: '20px',
                    backgroundColor: '#fff5f5',
                    border: '2px solid #dc3545',
                    borderRadius: '12px',
                    boxShadow: '0 4px 12px rgba(220, 53, 69, 0.15)'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginBottom: '16px'
                    }}>
                        <h3 style={{
                            margin: 0,
                            fontSize: '20px',
                            fontWeight: 700,
                            color: '#dc3545'
                        }}>
                            Глобальные Риски
                        </h3>
                    </div>
                    {globalRisks.map((risk, ridx) => {
                        const riskColor = risk.risk_level === 'HIGH' ? '#dc3545' :
                            risk.risk_level === 'MEDIUM' ? '#ffc107' : '#28a745';
                        return (
                            <div key={`global-risk-${ridx}`} style={{
                                marginBottom: ridx < globalRisks.length - 1 ? '20px' : '0',
                                paddingBottom: ridx < globalRisks.length - 1 ? '20px' : '0',
                                borderBottom: ridx < globalRisks.length - 1 ? '2px solid #fecaca' : 'none'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    marginBottom: '12px',
                                    flexWrap: 'wrap'
                                }}>
                                    <span style={{
                                        padding: '6px 12px',
                                        backgroundColor: riskColor,
                                        color: '#fff',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 700
                                    }}>
                                        {risk.risk_level}
                                    </span>
                                    <span style={{
                                        fontSize: '16px',
                                        fontWeight: 700,
                                        color: '#111'
                                    }}>
                                        Изменен: {risk.source}
                                    </span>
                                    <span style={{
                                        fontSize: '13px',
                                        color: '#6c757d',
                                        backgroundColor: '#fff',
                                        padding: '4px 10px',
                                        borderRadius: '4px',
                                        border: '1px solid #dee2e6'
                                    }}>
                                        Затронуто страниц: {risk.affected_pages_count || 0}
                                    </span>
                                </div>
                                <div style={{
                                    fontSize: '14px',
                                    color: '#111',
                                    lineHeight: 1.6,
                                    marginBottom: '12px',
                                    padding: '12px',
                                    backgroundColor: '#fff',
                                    borderRadius: '6px',
                                    border: '1px solid #fecaca'
                                }}>
                                    <strong style={{ color: '#dc3545' }}>Влияние:</strong> {risk.description}
                                </div>
                                {risk.advice && risk.advice.length > 0 && (
                                    <div style={{
                                        marginTop: '12px',
                                        padding: '12px',
                                        backgroundColor: '#fff',
                                        borderRadius: '6px',
                                        border: '1px solid #fecaca'
                                    }}>
                                        <div style={{
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: '#dc3545',
                                            marginBottom: '8px'
                                        }}>
                                            Совет AI:
                                        </div>
                                        <ol style={{
                                            margin: 0,
                                            paddingLeft: '20px',
                                            color: '#111'
                                        }}>
                                            {risk.advice.map((adviceItem, aidx) => (
                                                <li key={`advice-${ridx}-${aidx}`} style={{
                                                    fontSize: '13px',
                                                    color: '#111',
                                                    marginBottom: '6px',
                                                    lineHeight: 1.5
                                                }}>
                                                    {adviceItem}
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Легенда */}
            <div style={{ marginBottom: 24, padding: 16, backgroundColor: '#f8f9fa', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#1e293b' }}>Легенда</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, fontSize: 13 }}>
                    <div>
                        <strong style={{ color: '#111' }}>Уровни риска:</strong>
                        <div style={{ marginTop: 4 }}>
                            <span style={{ padding: '2px 8px', backgroundColor: '#dc3545', color: '#fff', borderRadius: 3, fontSize: 11, marginRight: 4 }}>HIGH</span>
                            <span style={{ color: '#111' }}> — высокий риск, требуется обязательное тестирование</span>
                        </div>
                        <div style={{ marginTop: 4 }}>
                            <span style={{ padding: '2px 8px', backgroundColor: '#ffc107', color: '#111', borderRadius: 3, fontSize: 11, marginRight: 4 }}>MEDIUM</span>
                            <span style={{ color: '#111' }}> — средний риск, рекомендуется тестирование</span>
                        </div>
                        <div style={{ marginTop: 4 }}>
                            <span style={{ padding: '2px 8px', backgroundColor: '#28a745', color: '#fff', borderRadius: 3, fontSize: 11, marginRight: 4 }}>LOW</span>
                            <span style={{ color: '#111' }}> — низкий риск, опциональное тестирование</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Общая статистика */}
            {summary && (
                <div style={{ marginBottom: 32 }}>
                    <h3 style={{ fontWeight: 700, fontSize: 18, marginBottom: 16, color: '#1e293b' }}>Общая статистика</h3>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                        <div style={{ ...styles.card, minWidth: 200, padding: '20px' }}>
                            <div style={{ fontWeight: 700, color: '#111', marginBottom: 4 }}>Test Coverage</div>
                            <div style={{ fontSize: 32, color: '#111', fontWeight: 700 }}>
                                {summary.test_coverage_percent?.toFixed(1) ?? 'N/A'}%
                            </div>
                            <div style={{ fontSize: 12, color: '#6c757d', marginTop: 4 }}>
                                Процент покрытия тестами затронутых страниц
                            </div>
                        </div>
                        <div style={{ ...styles.card, minWidth: 200, padding: '20px' }}>
                            <div style={{ fontWeight: 700, color: '#111', marginBottom: 4 }}>Затронуто страниц</div>
                            <div style={{ fontSize: 32, color: '#111', fontWeight: 700 }}>
                                {summary.impacted_pages ?? 0} / {summary.total_pages ?? 0}
                            </div>
                            <div style={{ fontSize: 12, color: '#6c757d', marginTop: 4 }}>
                                Количество страниц с изменениями из общего числа
                            </div>
                        </div>
                        <div style={{ ...styles.card, minWidth: 240, padding: '20px' }}>
                            <div style={{ fontWeight: 700, color: '#111', marginBottom: 4 }}>Распределение рисков</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                                <div style={{ color: '#111' }}>
                                    <span style={{ color: '#dc3545', fontWeight: 600 }}>HIGH:</span> {summary.risk_counts?.HIGH ?? 0}
                                </div>
                                <div style={{ color: '#111' }}>
                                    <span style={{ color: '#ffc107', fontWeight: 600 }}>MEDIUM:</span> {summary.risk_counts?.MEDIUM ?? 0}
                                </div>
                                <div style={{ color: '#111' }}>
                                    <span style={{ color: '#28a745', fontWeight: 600 }}>LOW:</span> {summary.risk_counts?.LOW ?? 0}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Список затронутых страниц */}
            {Array.isArray(pages) && pages.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                    <h3 style={{ fontWeight: 700, fontSize: 18, marginBottom: 16, color: '#1e293b' }}>
                        Затронутые страницы ({pages.length})
                    </h3>

                    {/* Страницы с высоким риском */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {pages.map((page, idx) => {
                            const pageKey = `page-${idx}`;
                            const isPageExpanded = !!expandedPageComponents[pageKey];
                            const riskLevel = page.ai_analysis?.risk_level || 'LOW';
                            const riskColor = riskLevel === 'HIGH' ? '#dc3545' :
                                riskLevel === 'MEDIUM' ? '#ffc107' : '#28a745';

                            return (
                                <div key={pageKey} style={{
                                    ...styles.card,
                                    padding: '20px',
                                    border: riskLevel === 'HIGH' ? '2px solid #dc3545' : '1px solid #e2e8f0',
                                    backgroundColor: riskLevel === 'HIGH' ? '#fff5f5' : '#fff'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 700, fontSize: 18, color: '#111', marginBottom: 8 }}>
                                                {page.page_meta?.name || page.route}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                                <span style={{
                                                    padding: '4px 10px',
                                                    borderRadius: 4,
                                                    backgroundColor: riskColor,
                                                    color: riskLevel === 'MEDIUM' ? '#111' : '#fff',
                                                    fontSize: 12,
                                                    fontWeight: 600
                                                }}>
                                                    {riskLevel} RISK
                                                </span>
                                                {page.page_meta?.route && (
                                                    <span style={{
                                                        padding: '4px 10px',
                                                        borderRadius: 4,
                                                        backgroundColor: '#17a2b8',
                                                        color: '#fff',
                                                        fontSize: 11,
                                                        fontFamily: 'monospace'
                                                    }}>
                                                        {page.page_meta.route}
                                                    </span>
                                                )}
                                            </div>
                                            {page.ai_analysis?.summary && (
                                                <div style={{ marginTop: 12, color: '#111', fontSize: 14, lineHeight: 1.6 }}>
                                                    {page.ai_analysis.summary}
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => setExpandedPageComponents(prev => ({ ...prev, [pageKey]: !isPageExpanded }))}
                                            style={{
                                                padding: '8px 16px',
                                                backgroundColor: riskLevel === 'HIGH' ? '#dc3545' : '#007bff',
                                                color: '#fff',
                                                border: 'none',
                                                borderRadius: 4,
                                                cursor: 'pointer',
                                                fontSize: 14,
                                                fontWeight: 600
                                            }}
                                        >
                                            {isPageExpanded ? 'Скрыть' : 'Подробнее'}
                                        </button>
                                    </div>

                                    {isPageExpanded && (
                                        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #dee2e6' }}>
                                            {renderQAAdvice(page.ai_analysis?.qa_advice || [])}

                                            {/* Компоненты */}
                                            {(page.depends_on_components || []).length > 0 && (
                                                <div style={{ marginTop: 16 }}>
                                                    <div style={{ fontWeight: 600, color: '#111', marginBottom: 8, fontSize: 14 }}>
                                                        Зависит от компонентов ({page.depends_on_components.length}):
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                        {page.depends_on_components.map((compName, cidx) => (
                                                            <span
                                                                key={`${pageKey}-comp-${cidx}`}
                                                                style={{
                                                                    padding: '4px 10px',
                                                                    backgroundColor: '#e9ecef',
                                                                    borderRadius: 4,
                                                                    fontSize: 12,
                                                                    color: '#111',
                                                                    fontWeight: 500
                                                                }}
                                                            >
                                                                {compName}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TIALightSummary;
