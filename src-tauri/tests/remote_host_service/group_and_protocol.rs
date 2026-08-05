//! 远程主机分组与协议边界回归。
//!
//! @author kongweiguang

use super::*;

#[test]
fn delete_group_moves_hosts_to_ungrouped() {
    let (_home, state) = test_state();
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "临时分组".to_owned(),
        })
        .expect("create group");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: Some(group.id.clone()),
            name: "临时主机".to_owned(),
            host: "temp.internal".to_owned(),
            port: 22,
            username: "root".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            ssh_options: Default::default(),
        })
        .expect("create host");

    assert!(state
        .remote_hosts()
        .delete_group(&group.id)
        .expect("delete group"));
    let tree = state.remote_hosts().list_tree().expect("list host tree");
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].name, "默认分组");
    assert_eq!(tree[0].hosts[0].id, host.id);
    assert_eq!(tree[0].hosts[0].group_id, None);
}

#[test]
fn create_host_rejects_unknown_group() {
    let (_home, state) = test_state();
    let error = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: Some("missing".to_owned()),
            name: "bad".to_owned(),
            host: "example.com".to_owned(),
            port: 22,
            username: "root".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            ssh_options: Default::default(),
        })
        .expect_err("reject unknown group");
    assert!(matches!(error, AppError::NotFound(_)));
}

#[test]
fn create_host_rejects_whitespace_in_host_address() {
    let (_home, state) = test_state();
    let error = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "bad host".to_owned(),
            host: "bad host".to_owned(),
            port: 22,
            username: "root".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            ssh_options: Default::default(),
        })
        .expect_err("reject host address whitespace");
    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn create_host_allows_no_group_and_lists_it_as_ungrouped() {
    let (_home, state) = test_state();
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "standalone".to_owned(),
            host: "standalone.internal".to_owned(),
            port: 22,
            username: "root".to_owned(),
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: vec!["adhoc".to_owned()],
            ssh_options: Default::default(),
        })
        .expect("create ungrouped host");
    assert_eq!(host.group_id, None);
    let tree = state.remote_hosts().list_tree().expect("list host tree");
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].id, "__ungrouped__");
    assert_eq!(tree[0].hosts[0].id, host.id);
}

#[test]
fn create_telnet_host_allows_empty_username_and_normalizes_tags() {
    let (_home, state) = test_state();
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "lab telnet".to_owned(),
            host: "lab.internal".to_owned(),
            port: 23,
            username: "   ".to_owned(),
            protocol: RemoteHostProtocol::Telnet,
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: vec![
                " TelNet ".to_owned(),
                "telnet".to_owned(),
                " console ".to_owned(),
            ],
            ssh_options: Default::default(),
        })
        .expect("create telnet host");
    assert_eq!(host.username, "");
    assert_eq!(host.tags, vec!["TelNet", "console"]);
}

#[test]
fn create_serial_host_allows_empty_username_and_normalizes_tags() {
    let (_home, state) = test_state();
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "serial console".to_owned(),
            host: "COM7".to_owned(),
            port: 1,
            username: "   ".to_owned(),
            protocol: RemoteHostProtocol::Serial,
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: vec![
                " Serial ".to_owned(),
                "serial".to_owned(),
                " serial-baud:115200 ".to_owned(),
            ],
            ssh_options: Default::default(),
        })
        .expect("create serial host");
    assert_eq!(host.username, "");
    assert_eq!(host.tags, vec!["Serial", "serial-baud:115200"]);
}

#[test]
fn create_non_telnet_host_rejects_empty_username() {
    let (_home, state) = test_state();
    let error = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "rdp host".to_owned(),
            host: "rdp.internal".to_owned(),
            port: 3389,
            username: " ".to_owned(),
            protocol: RemoteHostProtocol::Rdp,
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: vec!["rdp".to_owned()],
            ssh_options: Default::default(),
        })
        .expect_err("reject empty username without telnet tag");
    assert!(matches!(error, AppError::InvalidInput(_)));
}
