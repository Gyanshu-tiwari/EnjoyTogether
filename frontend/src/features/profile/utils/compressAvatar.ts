import imageCompression from 'browser-image-compression';

/**
 * Compresses an incoming image file to a max width/height of 400px,
 * converts it to image/webp format, and aims for a maximum size of ~100KB.
 */
export async function compressAvatar(file: File): Promise<File> {
  const options = {
    maxSizeMB: 0.1, // target size ~100KB
    maxWidthOrHeight: 400, // resize to maximum 400x400
    useWebWorker: true,
    fileType: 'image/webp',
  };

  try {
    console.log(`[compressAvatar] Original file: ${file.name}, size: ${(file.size / 1024).toFixed(2)}KB`);
    const compressedBlob = await imageCompression(file, options);
    
    // Extract base name without extension
    const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const compressedFile = new File([compressedBlob], `${baseName}.webp`, {
      type: 'image/webp',
      lastModified: Date.now(),
    });
    
    console.log(`[compressAvatar] Compressed file size: ${(compressedFile.size / 1024).toFixed(2)}KB`);
    return compressedFile;
  } catch (error) {
    console.error('[compressAvatar] Compression failed:', error);
    throw new Error('Image compression failed. Please try a different image.');
  }
}
