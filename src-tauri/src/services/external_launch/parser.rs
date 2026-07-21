//! External SSH launch parser registry.
//!
//! @author kongweiguang

use crate::error::{AppError, AppResult};

use super::{
    classifier::infer_source_tool_from_args,
    model::{ExternalLaunchParseInput, ExternalLaunchSourceTool, ExternalSshLaunchRequest},
    parsers::{
        KerminalNativeParser, MobaXtermParser, OpenSshParser, PuttyParser, SecureCrtParser,
        SftpClientParser, XshellParser,
    },
};

const EXTERNAL_LAUNCH_MAX_ARG_COUNT: usize = 256;
const EXTERNAL_LAUNCH_MAX_ARG_BYTES: usize = 32 * 1024;
const EXTERNAL_LAUNCH_MAX_TOTAL_ARG_BYTES: usize = 64 * 1024;

/// Parser for one external terminal persona.
pub trait ExternalLaunchParser: Send + Sync {
    fn tool(&self) -> ExternalLaunchSourceTool;
    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>>;
}

/// Registry that selects a persona parser and returns a normalized request.
pub struct ExternalLaunchParserRegistry {
    parsers: Vec<Box<dyn ExternalLaunchParser>>,
}

impl Default for ExternalLaunchParserRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ExternalLaunchParserRegistry {
    pub fn new() -> Self {
        Self {
            parsers: vec![
                Box::new(PuttyParser),
                Box::new(MobaXtermParser),
                Box::new(XshellParser),
                Box::new(SecureCrtParser),
                Box::new(OpenSshParser),
                Box::new(SftpClientParser),
                Box::new(KerminalNativeParser),
            ],
        }
    }

    pub fn parse(&self, input: &ExternalLaunchParseInput) -> AppResult<ExternalSshLaunchRequest> {
        if input.argv.is_empty() {
            return Err(AppError::InvalidInput(
                "external SSH launch argv must not be empty".to_owned(),
            ));
        }
        validate_input_size(input)?;
        let inferred_tool = input
            .source_tool
            .or_else(|| infer_source_tool_from_args(&input.argv));
        for parser in &self.parsers {
            if inferred_tool.is_some_and(|tool| tool != parser.tool()) {
                continue;
            }
            if let Some(request) = parser.parse(input)? {
                return Ok(request);
            }
        }
        Err(AppError::InvalidInput(format!(
            "unsupported external SSH launch arguments from {}",
            input.argv[0]
        )))
    }
}

/// 在 persona parser 前统一限制深层命令、URL 与父进程命令行的资源消耗。
fn validate_input_size(input: &ExternalLaunchParseInput) -> AppResult<()> {
    if input.argv.len() > EXTERNAL_LAUNCH_MAX_ARG_COUNT
        || input
            .argv
            .iter()
            .any(|argument| argument.len() > EXTERNAL_LAUNCH_MAX_ARG_BYTES)
        || input.argv.iter().map(String::len).sum::<usize>() > EXTERNAL_LAUNCH_MAX_TOTAL_ARG_BYTES
        || input
            .parent_command_line
            .as_ref()
            .is_some_and(|command| command.len() > EXTERNAL_LAUNCH_MAX_TOTAL_ARG_BYTES)
    {
        return Err(AppError::InvalidInput(
            "external SSH launch arguments exceed the supported size limit".to_owned(),
        ));
    }
    Ok(())
}
