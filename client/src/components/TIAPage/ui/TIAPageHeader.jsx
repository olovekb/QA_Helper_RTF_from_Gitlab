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
                    onClick={() => navigate('/')}
                >
                    Назад
                </button>
                <button
                    style={{
                        ...styles.backButton,
                        backgroundColor: '#007bff',
                        color: '#fff',
                        borderColor: '#007bff',
                    }}
                    onClick={() => navigate('/heatmap')}
                >
                    Тепловая карта дефектов
                </button>
            </div>
        </div>
    );
};

export default TIAPageHeader;

