use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub(crate) struct CoreRequest {
    #[serde(default, rename = "protocolVersion")]
    pub(crate) protocol_version: Option<u32>,
    #[serde(default, alias = "requestId")]
    pub(crate) id: String,
    pub(crate) command: String,
    #[serde(default)]
    pub(crate) payload: Value,
}

#[derive(Debug, Serialize)]
struct CoreResponse {
    #[serde(skip_serializing_if = "Option::is_none", rename = "protocolVersion")]
    protocol_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "requestId")]
    request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sequence: Option<u64>,
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ResponseError>,
}

#[derive(Debug, Serialize)]
struct ResponseError {
    message: String,
    code: String,
}

#[derive(Debug, Clone)]
pub(crate) struct CommandError {
    pub(crate) code: String,
    pub(crate) message: String,
}

impl CommandError {
    pub(crate) fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub(crate) fn failed(error: anyhow::Error) -> Self {
        Self::new("command_failed", error.to_string())
    }
}

pub(crate) fn response_ok_versioned(
    id: &str,
    payload: Value,
    protocol_version: Option<u32>,
    sequence: Option<u64>,
) -> String {
    serde_json::to_string(&CoreResponse {
        protocol_version,
        request_id: protocol_version.map(|_| id.to_string()),
        sequence,
        id: id.to_string(),
        ok: true,
        payload: Some(payload),
        error: None,
    })
    .unwrap_or_else(|_| "{\"id\":\"\",\"ok\":false,\"error\":{\"message\":\"response serialization failed\",\"code\":\"internal\"}}".to_string())
}

pub(crate) fn response_error(id: &str, code: &str, message: impl Into<String>) -> String {
    response_error_versioned(id, code, message, None, None)
}

pub(crate) fn response_error_versioned(
    id: &str,
    code: &str,
    message: impl Into<String>,
    protocol_version: Option<u32>,
    sequence: Option<u64>,
) -> String {
    serde_json::to_string(&CoreResponse {
        protocol_version,
        request_id: protocol_version.map(|_| id.to_string()),
        sequence,
        id: id.to_string(),
        ok: false,
        payload: None,
        error: Some(ResponseError {
            message: message.into(),
            code: code.to_string(),
        }),
    })
    .unwrap_or_else(|_| "{\"id\":\"\",\"ok\":false,\"error\":{\"message\":\"response serialization failed\",\"code\":\"internal\"}}".to_string())
}
