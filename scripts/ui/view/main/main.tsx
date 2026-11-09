import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import "../../main.css";
import {loadAppData} from "../../controller/app/CosmosApp.Controller";
import CosmosApp from "../app/CosmosApp";
import CosmosConfirmDialog from "../confirm/CosmosConfirmDialog";
import CosmosContextMenu from "../contextmenu/CosmosContextMenu";
import CosmosToast from "../toast/CosmosToast";

async function start(): Promise<void> {
    await loadAppData(); // settings, theme and data are ready before anything is drawn
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <CosmosApp/>
            <CosmosConfirmDialog/>
            <CosmosToast/>
            <CosmosContextMenu/>
        </StrictMode>
    );
}

void start();
