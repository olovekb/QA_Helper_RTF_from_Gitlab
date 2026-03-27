import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execPromise = promisify(exec);

async function debugOcr(imagePath, targetText = 'все') {
    const scriptPath = path.join(process.cwd(), 'server', 'scripts', 'ocr_worker.py');
    const absoluteImagePath = path.resolve(imagePath);

    console.log('--- OCR DEBUG START ---');
    console.log(`Image: ${absoluteImagePath}`);
    console.log(`Target: ${targetText}`);
    console.log(`Script: ${scriptPath}`);

    try {
        await fs.access(absoluteImagePath);
    } catch (err) {
        console.error(`Error: Image file not found at ${absoluteImagePath}`);
        return;
    }

    const command = `python "${scriptPath}" "${absoluteImagePath}" "${targetText}"`;
    console.log(`Command: ${command}`);

    try {
        const { stdout, stderr } = await execPromise(command, {
            env: { ...process.env }
        });

        if (stderr) {
            console.error('STDERR:', stderr);
        }

        console.log('--- OUTPUT ---');
        console.log(stdout);

        try {
            const result = JSON.parse(stdout);
            console.log('--- PARSED JSON ---');
            console.dir(result, { depth: null });
        } catch (parseErr) {
            console.error('Failed to parse JSON output:', parseErr.message);
        }

    } catch (err) {
        console.error('Execution Error:', err.message);
        if (err.stdout) console.log('STDOUT:', err.stdout);
        if (err.stderr) console.error('STDERR:', err.stderr);
    }
    console.log('--- OCR DEBUG END ---');
}

const args = process.argv.slice(2);
const image = args[0];
const target = args[1] || 'все';

if (!image) {
    console.log('Usage: node server/scripts/debug_ocr.mjs <image_path> [target_text]');
    process.exit(1);
}

debugOcr(image, target);
