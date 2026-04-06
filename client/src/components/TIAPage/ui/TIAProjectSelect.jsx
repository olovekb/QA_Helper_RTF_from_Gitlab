import React from 'react';
import { useTIA } from '../context/TIAContext';
import { setupStyles } from '../styles/TIAStyles';
import Loader from '../../../Loader';

/**
 * Компонент выбора проекта (адаптирован под Setup Screen 1:1)
 * @returns {JSX.Element}
 */
const TIAProjectSelect = () => {
    const { projects, projectId, handleProjectChange, structureLoading } = useTIA();

    return (
        <div style={{ marginBottom: '24px' }}>
            <h3 style={setupStyles.sectionTitle}>Выберите проект Allure</h3>
            <div style={{ position: 'relative' }}>
                <select
                    style={{
                        padding: '16px',
                        width: '100%',
                        borderRadius: '16px',
                        border: '1px solid #e2e8f0',
                        backgroundColor: '#f8fafc',
                        fontSize: '16px',
                        outline: 'none',
                        cursor: 'pointer',
                        appearance: 'none',
                        backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E")',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 16px center',
                        backgroundSize: '20px'
                    }}
                    value={projectId}
                    onChange={handleProjectChange}
                    disabled={structureLoading}
                >
                    <option value="">Выберите проект...</option>
                    {Array.isArray(projects) && projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.name}
                        </option>
                    ))}
                </select>
                {structureLoading && (
                    <div style={{ position: 'absolute', right: '40px', top: '50%', transform: 'translateY(-50%)' }}>
                        <Loader size="20px" />
                    </div>
                )}
            </div>
        </div>
    );
};

export default TIAProjectSelect;
