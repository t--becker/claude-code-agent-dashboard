import type {
	ArtifactItem,
	AnswerInput,
	BootstrapResponse,
	CreateSessionInput,
	Session,
	PermissionMode,
	PromptFile,
} from '@shared/types';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		...init,
		headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
	});
	if (response.status === 204) return undefined as T;
	const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
	if (!response.ok)
		throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`);
	return body;
}

const post = <T>(url: string, body?: unknown) =>
	request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
	bootstrap: () => request<BootstrapResponse>('/api/bootstrap'),
	artifacts: () => request<ArtifactItem[]>('/api/artifacts'),
	create: (input: CreateSessionInput) => post<Session>('/api/sessions', input),
	prompt: (id: string, text: string, files: PromptFile[] = []) =>
		post<Session>(`/api/sessions/${id}/prompt`, files.length ? { text, files } : { text }),
	rename: (id: string, title: string) => post<Session>(`/api/sessions/${id}/title`, { title }),
	setIcon: (id: string, icon: string | null) => post<Session>(`/api/sessions/${id}/icon`, { icon }),
	pickFolder: () => post<{ path?: string; cancelled?: boolean }>('/api/pick-folder', {}),
	stop: (id: string) => post<Session>(`/api/sessions/${id}/stop`),
	resume: (id: string) => post<Session>(`/api/sessions/${id}/resume`),
	close: (id: string) => post<Session>(`/api/sessions/${id}/close`),
	reopen: (id: string) => post<Session>(`/api/sessions/${id}/reopen`),
	setModel: (id: string, model: string) => post<Session>(`/api/sessions/${id}/model`, { model }),
	setPermissionMode: (id: string, mode: PermissionMode) =>
		post<Session>(`/api/sessions/${id}/permissions`, { mode }),
	setAllPermissions: (mode: PermissionMode) =>
		post<BootstrapResponse>('/api/permissions', { mode }),
	answer: (id: string, input: AnswerInput) => post<Session>(`/api/sessions/${id}/answer`, input),
	remove: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
};
