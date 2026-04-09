import { useTIA } from '../context/TIAContext';
import { setupStyles } from '../styles/TIAStyles';

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
            </div>
        </div>
    );
};

export default TIAProjectSelect;
