"""Genera el Atajo compartido "Luke Apple Pay" (sin firmar). Firmar con:
    shortcuts sign --mode anyone -i shortcut/build/unsigned.shortcut -o "shortcut/build/Luke Apple Pay.shortcut"

El Atajo es mínimo a propósito: el código de la persona queda dentro del Atajo (se pega al
instalarlo), así no lee archivos, que iOS no permite con el iPhone bloqueado. Toda la lógica
está en el servidor, que responde con el `message` que el Atajo muestra como notificación.
"""
import plistlib
import sys
import uuid
from pathlib import Path

SERVER = (sys.argv[1] if len(sys.argv) > 1 else "https://luke-app-production.up.railway.app").rstrip("/")
OBJ = "￼"  # marcador de variable dentro de un texto


def uid():
    return str(uuid.uuid4()).upper()


def output(action_uuid, name):
    return {"Type": "ActionOutput", "OutputUUID": action_uuid, "OutputName": name}


def text(*parts):
    """Texto con variables: text("Bearer ", var)."""
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


def action(identifier, **params):
    return {"WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}", "WFWorkflowActionParameters": params}


code, response, message = uid(), uid(), uid()
actions = [
    # 1. El código personal: se pega al agregar el Atajo (pregunta de importación).
    action("gettext", UUID=code, WFTextActionText=""),
    # 2. Envía la compra (o nada, si se abrió a mano: el servidor lo toma como prueba de conexión).
    action(
        "downloadurl",
        UUID=response,
        WFURL=f"{SERVER}/ingest/apple-pay",
        WFHTTPMethod="POST",
        ShowHeaders=True,
        WFHTTPHeaders=fields(Authorization=text("Bearer ", output(code, "Text"))),
        WFHTTPBodyType="JSON",
        WFJSONValues=fields(raw=text({"Type": "ExtensionInput"})),
    ),
    # 3 y 4. Muestra lo que respondió Luke.
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
    ],
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowActions": actions,
}

out = Path(__file__).parent / "build" / "unsigned.shortcut"
out.parent.mkdir(exist_ok=True)
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(f"{out} ({len(actions)} acciones, servidor {SERVER})")
