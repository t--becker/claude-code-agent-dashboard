import {
	IMAGE_TYPES,
	MAX_FILES,
	MAX_FILE_BYTES,
	MAX_IMAGE_BYTES,
	MAX_TOTAL_BYTES,
	type PromptFile,
} from '@shared/types';

/** A file waiting in the composer. */
export interface ComposerFile extends PromptFile {
	id: string;
	/** Size of what will be sent, in bytes. */
	size: number;
	/** `data:` address for the thumbnail; pictures only. */
	url?: string;
}

/** Above this a picture is scaled down before sending: screenshots from a large display often are. */
const SHRINK_ABOVE_BYTES = 3.5 * 1024 * 1024;
const LONGEST_SIDE = 2000;

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const readAsDataUrl = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
		reader.readAsDataURL(blob);
	});

/** Redraws a large picture at most 2000px on its longest side, as a JPEG. */
async function shrink(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Could not resize the image');
	// JPEG has no transparency, so put the picture on white rather than black.
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Could not resize the image'))),
			'image/jpeg',
			0.9
		)
	);
}

export interface ReadFiles {
	files: ComposerFile[];
	/** One line per file that could not be attached, ready to show. */
	problems: string[];
}

/**
 * Turns pasted, dropped or chosen files into attachments ready to send. Any type is accepted.
 * `room` is how many more fit and `roomBytes` how much more they may weigh together.
 */
export async function readFiles(
	chosen: File[],
	room = MAX_FILES,
	roomBytes = MAX_TOTAL_BYTES
): Promise<ReadFiles> {
	const files: ComposerFile[] = [];
	const problems: string[] = [];
	let left = roomBytes;
	for (const file of chosen) {
		let name = file.name || 'pasted file';
		if (files.length >= room) {
			problems.push(`Only ${MAX_FILES} files fit in one prompt`);
			break;
		}
		try {
			const isImage = IMAGE_TYPES.includes(file.type);
			let blob: Blob = file;
			// A big picture is scaled down so the model can be shown it. An animated GIF would lose
			// its frames, and a picture that will not scale is still sent, as an ordinary file.
			if (isImage && file.size > SHRINK_ABOVE_BYTES && file.type !== 'image/gif')
				blob = await shrink(file).catch(() => file);
			// A scaled-down picture is a JPEG now, whatever it was called.
			if (blob !== file) name = `${name.replace(/\.[^.]+$/, '')}.jpg`;
			if (!blob.size) {
				problems.push(`${name} is empty or is a folder`);
				continue;
			}
			if (blob.size > MAX_FILE_BYTES) {
				problems.push(`${name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
				continue;
			}
			if (blob.size > left) {
				problems.push(
					`${name} does not fit: one prompt carries ${MAX_TOTAL_BYTES / 1024 / 1024} MB in total`
				);
				continue;
			}
			const url = await readAsDataUrl(blob);
			const mediaType = blob.type || file.type || 'application/octet-stream';
			left -= blob.size;
			files.push({
				id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
				name,
				mediaType,
				data: url.slice(url.indexOf(',') + 1),
				size: blob.size,
				...(isImage && blob.size <= MAX_IMAGE_BYTES ? { url } : {}),
			});
		} catch {
			problems.push(`${name} could not be read`);
		}
	}
	return { files, problems };
}

/**
 * Files carried by a paste; empty when it holds none. Text copied from a document or a
 * spreadsheet often comes with a picture of itself: that is a text paste, so the picture is left.
 */
export function pastedFiles(transfer: DataTransfer | null): File[] {
	if (!transfer) return [];
	const types = [...(transfer.types ?? [])];
	if (types.includes('text/plain') && types.includes('text/html')) return [];
	return [...transfer.files];
}
