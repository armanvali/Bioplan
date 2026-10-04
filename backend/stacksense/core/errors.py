from __future__ import annotations


class DomainError(Exception):
    """An expected failure with a stable code the API maps to a 4xx response."""

    status_code = 400

    def __init__(self, code: str, message: str, **details: object) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


class NotFound(DomainError):
    status_code = 404


class Forbidden(DomainError):
    status_code = 403


class Unauthorized(DomainError):
    status_code = 401


class Conflict(DomainError):
    status_code = 409


class PaymentRequired(DomainError):
    status_code = 402
