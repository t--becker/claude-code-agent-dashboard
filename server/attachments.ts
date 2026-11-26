import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	IMAGE_TYPES,
	MAX_FILES,
	MAX_FILE_BYTES,
	MAX_IMAGE_BYTES,
	MAX_TOTAL_BYTES,
	type PromptFile,
} from '@shared/types';

/** A file sent with a prompt, once it is saved on this machine. */
export interface SavedFile {
	/** The name it was attached under, cleaned up. */
	name: string;
	mediaType: string;
	/** Absolute path of the saved copy. */
	path: string;
	/**
	 * Base64 content, kept only for a picture the model can be shown directly. Every other file
	 * is given to the agent by its path, to open with its own tools.
	 */
	imageData?: string;
}

export class AttachmentError extends Error {}

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * The file's own name, made safe to use as one path segment: no folders, no leading dot (hidden
 * files are never served), nothing but letters, digits, dot, dash, underscore and space.
 */
export function safeName(name: unknown): string {
	const base = typeof name === 'string' ? (name.split(/[\\/]/).pop() ?? '') : '';
	const clean = base
		.normalize('NFC')
		.replace(/[^\p{L}\p{N}._ -]/gu, '_')
		.slice(-120)
		.replace(/^[. ]+/, '')
		.trim();
	return clean || 'file';
}

/** True when the bytes really are the kind of picture the browser said they were. */
function looksLike(mediaType: string, bytes: Buffer): boolean {
	const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
	switch (mediaType) {
		case 'image/png':
			return starts(0x89, 0x50, 0x4e, 0x47);
		case 'image/jpeg':
			return starts(0xff, 0xd8, 0xff);
		case 'image/gif':
			return starts(0x47, 0x49, 0x46, 0x38);
		case 'image/webp':
			return (
				bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
				bytes.subarray(8, 12).toString('latin1') === 'WEBP'
			);
		default:
			return false;
	}
}

/**
 * Checks and saves the files attached to one prompt, any type. Each lands in `dir` under a
 * generated prefix plus its cleaned-up name, so nothing the browser sends decides where a file
 * goes, and two files with one name do not collide.
 */
export async function saveFiles(dir: string, files: PromptFile[]): Promise<SavedFile[]> {
	if (!Array.isArray(files)) throw new AttachmentError('Attached files must be a list');
	if (files.length > MAX_FILES)
		throw new AttachmentError(`Attach at most ${MAX_FILES} files to one prompt`);
	const checked: { name: string; mediaType: string; bytes: Buffer; data: string }[] = [];
	let total = 0;
	for (const file of files) {
		const name = safeName(file?.name);
		if (typeof file?.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data))
			throw new AttachmentError(`${name} could not be read`);
		const bytes = Buffer.from(file.data, 'base64');
		if (!bytes.length) throw new AttachmentError(`${name} is empty`);
		if (bytes.length > MAX_FILE_BYTES)
			throw new AttachmentError(`${name} is larger than ${megabytes(MAX_FILE_BYTES)}`);
		total += bytes.length;
		if (total > MAX_TOTAL_BYTES)
			throw new AttachmentError(
				`The attached files are larger than ${megabytes(MAX_TOTAL_BYTES)} together`
			);
		const mediaType =
			typeof file.mediaType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(file.mediaType)
				? file.mediaType
				: 'application/octet-stream';
		checked.push({ name, mediaType, bytes, data: file.data });
	}
	const saved: SavedFile[] = [];
	for (const file of checked) {
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		const target = path.join(dir, `${randomUUID().slice(0, 8)}-${file.name}`);
		await fs.writeFile(target, file.bytes, { mode: 0o600 });
		const isImage =
			IMAGE_TYPES.includes(file.mediaType) &&
			file.bytes.length <= MAX_IMAGE_BYTES &&
			looksLike(file.mediaType, file.bytes);
		saved.push({
			name: file.name,
			mediaType: file.mediaType,
			path: target,
			...(isImage ? { imageData: file.data } : {}),
		});
	}
	return saved;
}
