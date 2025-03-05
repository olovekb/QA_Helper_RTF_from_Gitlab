// client/src/components/Loader.js
import React from 'react';
import styles from './styles';

const Loader = () => (
    <div style={styles.loaderSpinner}>
        <div style={styles.spinner}></div>
    </div>
);

export default Loader;