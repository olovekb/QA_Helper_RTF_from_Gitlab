import { useTIA } from '../context/TIAContext';
import { setupStyles } from '../styles/TIAStyles';
import Loader from '../../../Loader';

/**
 * Компонент выбора проекта
 * @returns {JSX.Element}
 */
const TIAProjectSelect = () => {
    const {
        projectId,
        projects,
        isLoading,
        structureLoading,
        handleProjectChange
    } = useTIA();

    return (
        <div style={setupStyles.formGroup}>
            <label style={setupStyles.label}>Выберите проект</label>
            <div style={{ position: 'relative' }}>
                <select
                    value={projectId}
                    onChange={handleProjectChange}
                    style={setupStyles.select}
                    disabled={isLoading || structureLoading}
                >
                    <option value="">Выберите проект</option>
                    {Array.isArray(projects) && projects.map((proj) => (
                        <option key={proj.id} value={proj.id}>
                            {proj.name}
                        </option>
                    ))}
                </select>
                {structureLoading && (
                    <div style={{
                        position: 'absolute',
                        right: '40px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        pointerEvents: 'none'
                    }}>
                        <Loader size="16px" />
                        <span style={{ 
                            fontSize: '12px', 
                            color: 'var(--primary-accent)', 
                            fontWeight: 600,
                            whiteSpace: 'nowrap'
                        }}>
                            Загрузка структуры...
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TIAProjectSelect;
