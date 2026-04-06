import React from 'react';
import { useTIA } from '../context/TIAContext';

/**
 * Компонент сводной информации для режима "Лайт"
 * @returns {JSX.Element|null}
 */
const TIALightSummary = () => {
    const { 
        frontendJSON, 
        backendJSON, 
        tiaReport
    } = useTIA();

    const report = frontendJSON || backendJSON || tiaReport;
    if (!report || !report.summary) return null;

    const { summary } = report;
    const riskData = summary.global_risk_assessment || {};

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', animation: 'fadeIn 0.4s ease-out' }}>
            {/* Global Risks */}
            <div style={{ padding: '32px 40px', backgroundColor: '#fff', borderRadius: '32px', border: '1px solid rgba(0,0,0,0.02)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1e293b', margin: '0 0 24px 0' }}>Глобальная оценка рисков</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginBottom: '24px' }}>
                    <div style={{ padding: '24px', backgroundColor: '#f8fafc', borderRadius: '20px', border: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Общий статус</div>
                        <div style={{ fontSize: '18px', fontWeight: 900, color: riskData.overall_risk === 'HIGH' ? '#dc2626' : '#10b981' }}>
                            {riskData.overall_status || 'N/A'}
                        </div>
                    </div>
                    
                    <div style={{ padding: '24px', backgroundColor: '#f8fafc', borderRadius: '20px', border: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Влияние изменений</div>
                        <div style={{ fontSize: '18px', fontWeight: 900, color: '#6366f1' }}>
                            {riskData.impact_level || 'N/A'}
                        </div>
                    </div>
                </div>

                <div style={{ padding: '24px', backgroundColor: '#eff6ff', borderRadius: '20px', border: '1px solid #dbeafe' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Аналитическая сводка</div>
                    <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#1e293b', fontWeight: 500, margin: 0 }}>
                        {riskData.summary || 'Сводка не сформирована.'}
                    </p>
                </div>
            </div>

            {/* General Advice */}
            <div style={{ padding: '32px 40px', backgroundColor: '#fff', borderRadius: '32px', border: '1px solid rgba(0,0,0,0.02)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1e293b', margin: '0 0 24px 0' }}>Рекомендации по тестированию</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {(summary.qa_advice || []).map((advice, idx) => (
                        <div key={idx} style={{ padding: '16px 20px', backgroundColor: '#f8fafc', borderRadius: '16px', border: '1px solid #f1f5f9', fontSize: '14px', color: '#334155', fontWeight: 500, display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <span style={{ color: '#10b981', fontWeight: 900 }}>•</span> {advice}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default TIALightSummary;
