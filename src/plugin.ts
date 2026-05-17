import streamDeck from "@elgato/streamdeck";
import { PrinterControlAction } from "./actions/printer-control";
import { PrintProgressAction } from "./actions/print-progress";
import { CpuRamAction, DriverTempsAction, CavityTempAction } from "./actions/system-stats";
import { NozzleTempAction, BedTempAction } from "./actions/temperatures";

streamDeck.actions.registerAction(new PrinterControlAction());
streamDeck.actions.registerAction(new PrintProgressAction());
streamDeck.actions.registerAction(new CpuRamAction());
streamDeck.actions.registerAction(new DriverTempsAction());
streamDeck.actions.registerAction(new CavityTempAction());
streamDeck.actions.registerAction(new NozzleTempAction());
streamDeck.actions.registerAction(new BedTempAction());

streamDeck.connect();
