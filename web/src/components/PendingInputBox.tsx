import { useState, type FormEvent } from 'react';
import type { AnswerInput, PendingInput } from '@shared/types';

interface Props {
	input: PendingInput;
	project: string;
	disabled: boolean;
	onAnswer: (answer: AnswerInput) => void;
}

export function PendingInputBox({ input, project, disabled, onAnswer }: Props) {
	const [text, setText] = useState('');
	const permission = input.kind === 'permission';
	const submitText = (event: FormEvent) => {
		event.preventDefault();
		if (!text.trim()) return;
		onAnswer({ text: text.trim() });
		setText('');
	};
	return (
		<div className="question" role="group" aria-label={input.title}>
			<strong>{permission ? 'Claude Code needs your permission' : 'Claude is asking you'}</strong>
			<div className="question-title">
				{input.title}
				{input.toolName && <span className="engine-tag tool-tag">{input.toolName}</span>}
			</div>
			{input.detail && <div className={`detail${permission ? ' code' : ''}`}>{input.detail}</div>}
			{permission && (
				<div className="question-help">
					Claude Code asks before it runs commands or changes files in {project}. Allow lets this
					one go ahead; Deny tells Claude to find another way.
				</div>
			)}
			<div className="options">
				{input.options.map((option) => (
					<button
						key={option.id}
						type="button"
						title={option.description}
						disabled={disabled}
						onClick={() => onAnswer({ optionId: option.id })}
					>
						{option.label}
					</button>
				))}
			</div>
			{input.allowFreeText && (
				<form className="free" onSubmit={submitText}>
					<input
						aria-label="Your answer"
						placeholder="Or type an answer…"
						value={text}
						disabled={disabled}
						onChange={(event) => setText(event.target.value)}
					/>
					<button type="submit" disabled={disabled || !text.trim()}>
						Reply
					</button>
				</form>
			)}
		</div>
	);
}
