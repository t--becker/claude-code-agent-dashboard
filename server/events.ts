import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@shared/types';

/** Fan-out point between the session manager and WebSocket clients. */
export class EventBus {
	private readonly emitter = new EventEmitter();

	publish(event: ServerEvent): void {
		this.emitter.emit('event', event);
	}

	subscribe(listener: (event: ServerEvent) => void): () => void {
		this.emitter.on('event', listener);
		return () => this.emitter.off('event', listener);
	}
}
