"""Builds the shared "Luke Apple Pay" Shortcut (unsigned). Sign it with:
    shortcuts sign --mode anyone -i shortcut/build/unsigned.shortcut -o "shortcut/build/Luke Apple Pay.shortcut"

The Shortcut is deliberately minimal: the person's code lives inside the Shortcut (pasted when
installing it), so it never reads files, which iOS doesn't allow while the iPhone is locked. All
the logic is on the server, which replies with the `message` the Shortcut shows as a notification.
"""
import plistlib
import sys
import uuid
from pathlib import Path

SERVER = (sys.argv[1] if len(sys.argv) > 1 else "https://luke-app-production.up.railway.app").rstrip("/")
OBJ = "￼"  # variable placeholder inside a text


def uid():
    return str(uuid.uuid4()).upper()


def output(action_uuid, name):
    return {"Type": "ActionOutput", "OutputUUID": action_uuid, "OutputName": name}


def text(*parts):
    """Text with variables: text("Bearer ", var)."""
    string, attachments = "", {}
    for part in parts:
        if isinstance(part, str):
            string += part
        else:
            attachments[f"{{{len(string)}, 1}}"] = part
            string += OBJ
    return {"Value": {"string": string, "attachmentsByRange": attachments}, "WFSerializationType": "WFTextTokenString"}


def fields(**items):
    return {
        "Value": {"WFDictionaryFieldValueItems": [{"WFItemType": 0, "WFKey": text(k), "WFValue": v} for k, v in items.items()]},
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def input_property(name):
    """A property of the Wallet purchase (Shortcut Input → Amount, Merchant…)."""
    return {"Type": "ExtensionInput", "Aggrandizements": [{"Type": "WFPropertyVariableAggrandizement", "PropertyName": name}]}


def action(identifier, **params):
    return {"WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}", "WFWorkflowActionParameters": params}


code, response, message = uid(), uid(), uid()
actions = [
    # 1. The personal code, pasted when adding the Shortcut (import question).
    action("gettext", UUID=code, WFTextActionText=""),
    # 2. Sends the purchase (or nothing, if run by hand: the server treats it as a connection test).
    action(
        "downloadurl",
        UUID=response,
        WFURL=f"{SERVER}/ingest/apple-pay",
        WFHTTPMethod="POST",
        ShowHeaders=True,
        WFHTTPHeaders=fields(Authorization=text("Bearer ", output(code, "Text"))),
        WFHTTPBodyType="JSON",
        # The properties carry the amount; `raw` (the purchase as text) only has the merchant,
        # but the server uses it if the others are missing or the Shortcut was run by hand (connection test).
        WFJSONValues=fields(
            amount=text(input_property("Amount")),
            merchant=text(input_property("Merchant")),
            card=text(input_property("Card or Pass")),
            raw=text({"Type": "ExtensionInput"}),
        ),
    ),
    # 3 and 4. Show Luke's reply.
    action(
        "getvalueforkey",
        UUID=message,
        WFGetDictionaryValueType="Value",
        WFDictionaryKey="message",
        WFInput={"Value": output(response, "Contents of URL"), "WFSerializationType": "WFTextTokenAttachment"},
    ),
    action("notification", WFNotificationActionTitle="Luke", WFNotificationActionBody=text(output(message, "Dictionary Value"))),
]

workflow = {
    "WFWorkflowClientVersion": "2607.0.2",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4292093695, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowImportQuestions": [{
        "ActionIndex": 0,
        "Category": "Parameter",
        "ParameterKey": "WFTextActionText",
        "DefaultValue": "",
        "Text": "Pega tu código de Luke (la página lo copió por ti)",
    }],
    "WFWorkflowTypes": [],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowInputContentItemClasses": [
        "WFAppContentItem", "WFAppStoreAppContentItem", "WFArticleContentItem", "WFContactContentItem",
        "WFDateContentItem", "WFEmailAddressContentItem", "WFFolderContentItem", "WFGenericFileContentItem",
        "WFImageContentItem", "WFiTunesProductContentItem", "WFLocationContentItem", "WFDCMapsLinkContentItem",
        "WFAVAssetContentItem", "WFPDFContentItem", "WFPhoneNumberContentItem", "WFRichTextContentItem",
        "WFSafariWebPageContentItem", "WFStringContentItem", "WFURLContentItem",
        # Without this class, iOS turns the Wallet purchase into text (merchant only) and the amount is lost.
        "WFWalletTransactionContentItem",
    ],
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowActions": actions,
}

out = Path(__file__).parent / "build" / "unsigned.shortcut"
out.parent.mkdir(exist_ok=True)
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(f"{out} ({len(actions)} actions, server {SERVER})")
