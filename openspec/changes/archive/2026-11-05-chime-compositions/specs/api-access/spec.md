## ADDED Requirements

### Requirement: End-user IP from clients
A client request MAY name the end user it acts for in an `X-End-User-IP` header, set by the client's server from its own incoming request. The API SHALL honour the header only on requests classified as **client**, and SHALL use it only to key per-end-user limits. On playground, legacy and refused requests it SHALL be ignored, and the playground's IP SHALL still come from the reverse proxy. A value that is not a valid IPv4 or IPv6 address SHALL be treated as absent. The API SHALL NOT store the value or write it to a log.

#### Scenario: Keyed client forwards its visitor
- **WHEN** windchime's server sends a keyed request with `X-End-User-IP: 203.0.113.7`
- **THEN** limits keyed by end user count it against `203.0.113.7`

#### Scenario: Header ignored without a key
- **WHEN** a keyless request sends `X-End-User-IP: 203.0.113.7`
- **THEN** its playground rate limit uses the proxy-forwarded IP, not the header

#### Scenario: Garbage value
- **WHEN** a keyed request sends `X-End-User-IP: not-an-ip`
- **THEN** it is treated as a request with no end-user IP
