// utils/fileStorage.js
export async function serializeFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve({
                name: file.name,
                type: file.type,
                dataUrl: reader.result
            });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function deserializeFile(obj) {
    const byteString = atob(obj.dataUrl.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new File([ab], obj.name, { type: obj.type });
}
