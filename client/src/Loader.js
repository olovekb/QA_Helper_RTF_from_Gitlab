// client/src/components/Loader.js
import React from 'react';
import styles from './styles';

const Loader = ({ style }) => (
    <div style={{ ...styles.loaderSpinner, ...style }}>
        <div style={styles.spinner}></div>
    </div>
);

export default Loader;