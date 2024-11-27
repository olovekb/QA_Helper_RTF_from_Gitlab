export function spinningLoader(text) {
    const spinnerFrames = ['|', '/', '-', '\\'];
    let i = 0;

    const interval = setInterval(() => {
        process.stdout.write(`\r${text}` + spinnerFrames[i]);
        i = (i + 1) % spinnerFrames.length;
    }, 100);

    return interval;
}