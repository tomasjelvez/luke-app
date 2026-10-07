"""Genera el Atajo compartido "Luke Apple Pay" (sin firmar). Firmar con:
    shortcuts sign --mode anyone -i build/unsigned.shortcut -o "build/Luke Apple Pay.shortcut"
"""
import plistlib
import sys
import uuid
from pathlib import Path

SERVER = (sys.argv[1] if len(sys.argv) > 1 else "https://luke-app-production.up.railway.app").rstrip("/")
OBJ = "￼"  # marcador de variable dentro de un texto


def uid():
    return str(uuid.uuid4()).upper()


# --- Variables --------------------------------------------------------------
SHORTCUT_INPUT = {"Type": "ExtensionInput"}


def output(action_uuid, name):
    return {"Type": "ActionOutput", "OutputUUID": action_uuid, "OutputName": name}


def named(name):
    return {"Type": "Variable", "VariableName": name}


def attachment(var):
    return {"Value": var, "WFSerializationType": "WFTextTokenAttachment"}


def text(*parts):
    """Texto con variables: text("Hola ", var, "!")."""
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
        "Value": {"WFDictionaryFieldValueItems": [
            {"WFItemType": 0, "WFKey": text(k), "WFValue": text(v)}
            for k, v in items.items()
        ]},
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def action(identifier, **params):
    return {"WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}", "WFWorkflowActionParameters": params}


# --- Control de flujo ---------------------------------------------------------
CONTAINS, HAS_ANY_VALUE, NO_VALUE = 99, 100, 101


def if_(var, condition, value=None):
    group = uid()
    params = {
        "GroupingIdentifier": group,
        "WFControlFlowMode": 0,
        "WFCondition": condition,
        "WFInput": {"Type": "Variable", "Variable": attachment(var)},
    }
    if value is not None:
        # Versiones recientes de Atajos ignoran el texto plano: tiene que ir como texto con tokens.
        params["WFConditionalActionString"] = text(value)
    return group, action("conditional", **params)


def otherwise(group):
    return action("conditional", GroupingIdentifier=group, WFControlFlowMode=1)


def end_if(group):
    return action("conditional", GroupingIdentifier=group, WFControlFlowMode=2, UUID=uid())


def alert(message, cancel=False):
    return action("alert", WFAlertActionTitle="Luke", WFAlertActionMessage=message, WFAlertActionCancelButtonShown=cancel)


def post(url, body, headers=None, out=None):
    params = {
        "UUID": out,
        "WFURL": url,
        "WFHTTPMethod": "POST",
        "WFHTTPBodyType": "JSON",
        "WFJSONValues": body,
    }
    if headers:
        params["ShowHeaders"] = True
        params["WFHTTPHeaders"] = headers
    return action("downloadurl", **params)


def get_value(key, var, out):
    return action("getvalueforkey", UUID=out, WFGetDictionaryValueType="Value", WFDictionaryKey=key, WFInput=attachment(var))


# --- El Atajo ---------------------------------------------------------------------
actions = []

# La entrada puede ser una compra o un texto; el If solo ofrece "contains" sobre texto.
input_text = uid()
actions.append(action("gettext", UUID=input_text, WFTextActionText=text(SHORTCUT_INPUT)))
INPUT_TEXT = output(input_text, "Text")

# A. Conexión: la web abre el Atajo con un código luke-setup-… como entrada.
setup, a = if_(INPUT_TEXT, CONTAINS, "luke-setup-")
actions.append(a)
connect = uid()
actions.append(post(f"{SERVER}/ingest/apple-pay/connect", fields(code=INPUT_TEXT), out=connect))
auth_value = uid()
actions.append(get_value("authorization", output(connect, "Contents of URL"), auth_value))
actions.append(action("setvariable", WFVariableName="Token", WFInput=attachment(output(auth_value, "Dictionary Value"))))
ok, a = if_(named("Token"), HAS_ANY_VALUE)
actions.append(a)
confirm = uid()
actions.append(get_value("confirm", output(connect, "Contents of URL"), confirm))
actions.append(alert(text(output(confirm, "Dictionary Value")), cancel=True))
actions.append(action(
    "documentpicker.save",
    WFInput=attachment(named("Token")),
    WFAskWhereToSave=False,
    WFFileDestinationPath="luke-token.txt",
    WFSaveFileOverwrite=True,
))
actions.append(alert("¡Listo! 🎉 Ahora crea la automatización de Wallet (último paso en la página de Luke)."))
actions.append(otherwise(ok))
error = uid()
actions.append(get_value("error", output(connect, "Contents of URL"), error))
actions.append(alert(text(output(error, "Dictionary Value"))))
actions.append(end_if(ok))
actions.append(action("exit"))
actions.append(otherwise(setup))
actions.append(end_if(setup))

# B. Compra: lee el token guardado y manda la entrada completa del pago.
token_file = uid()
actions.append(action(
    "documentpicker.open",
    UUID=token_file,
    WFGetFilePath="luke-token.txt",
    WFFileErrorIfNotFound=False,
    WFShowFilePicker=False,
))
missing, a = if_(output(token_file, "File"), NO_VALUE)
actions.append(a)
actions.append(action("notification", WFNotificationActionTitle="Luke",
                      WFNotificationActionBody=f"Conecta tu iPhone en {SERVER}/cuenta/apple-pay"))
actions.append(action("exit"))
actions.append(otherwise(missing))
actions.append(end_if(missing))
token_text = uid()
actions.append(action("detect.text", UUID=token_text, WFInput=attachment(output(token_file, "File"))))
actions.append(post(
    f"{SERVER}/ingest/apple-pay",
    fields(raw=INPUT_TEXT),
    headers=fields(Authorization=output(token_text, "Text")),
    out=uid(),
))

workflow = {
    "WFWorkflowClientVersion": "2607.0.2",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4292093695, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowImportQuestions": [],
    "WFWorkflowTypes": [],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowInputContentItemClasses": [
        "WFAppContentItem", "WFAppStoreAppContentItem", "WFArticleContentItem", "WFContactContentItem",
        "WFDateContentItem", "WFEmailAddressContentItem", "WFFolderContentItem", "WFGenericFileContentItem",
        "WFImageContentItem", "WFiTunesProductContentItem", "WFLocationContentItem", "WFDCMapsLinkContentItem",
        "WFAVAssetContentItem", "WFPDFContentItem", "WFPhoneNumberContentItem", "WFRichTextContentItem",
        "WFSafariWebPageContentItem", "WFStringContentItem", "WFURLContentItem",
    ],
    "WFWorkflowNoInputBehavior": {"Name": "WFWorkflowNoInputBehaviorAskForInput", "Parameters": {"ItemClass": "WFStringContentItem"}},
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowActions": actions,
}

out = Path(__file__).parent / "build" / "unsigned.shortcut"
out.parent.mkdir(exist_ok=True)
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(f"{out} ({len(actions)} acciones, servidor {SERVER})")
