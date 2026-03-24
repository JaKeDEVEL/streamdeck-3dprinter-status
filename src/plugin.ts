import streamDeck from "@elgato/streamdeck";
import { PrinterControlAction } from "./actions/printer-control";
import { PrintProgressAction } from "./actions/print-progress";

streamDeck.actions.registerAction(new PrinterControlAction());
streamDeck.actions.registerAction(new PrintProgressAction());

streamDeck.connect();
