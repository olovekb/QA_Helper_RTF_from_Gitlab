import { useNavigate } from 'react-router-dom';
import { styles } from '../styles/TIAStyles';

/**
 * Хедер страницы TIA
 */
const TIAPageHeader = () => {
    const navigate = useNavigate();

    return (
        <div style={styles.headerSection}>
            <h1 style={styles.title}>Test Impact Analysis</h1>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                    style={styles.backButton}
                    onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)', e.currentTarget.style.color = 'var(--text-secondary)')}
                    onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)', e.currentTarget.style.color = 'var(--text-muted)')}
                    onClick={() => navigate('/')}
                >
                    Назад
                </button>
                <button
                    style={styles.primaryButton}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--primary-hover)')}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'var(--primary-accent)')}
                    onClick={() => navigate('/heatmap')}
                >
                    Тепловая карта дефектов
                </button>
            </div>
        </div>
    );
};

export default TIAPageHeader;

