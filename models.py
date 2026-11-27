"""Shared message identity and read-only source diagnostics."""
from dataclasses import dataclass, field
import re


@dataclass(frozen=True)
class Message:
    source: str
    conversation_id: str
    timestamp: str
    text: str
    message_id: str = ''
    timestamp_quality: str = 'message'


@dataclass
class SourceStatus:
    name: str
    state: str
    detail: str
    files: int = 0
    messages: int = 0
    skipped: int = 0
    paths: list = field(default_factory=list)
    issues: list = field(default_factory=list)
    coverage: str = ''


INJECTED_BLOCK = re.compile(r'<(environment_context|system[-_]reminder|turn_aborted|user_info|task-notification|skill)\b[^>]*>.*?</\1>',re.I|re.S)


def clean_user_text(text):
    return INJECTED_BLOCK.sub('',text).strip()


def generated(text):
    prefix=text.lstrip().lower()
    return prefix.startswith(('<skill>','<local-command-stdout>','<teammate-message>','<task-notification>')) or prefix.startswith('this session is being continued from a previous conversation')
