import type {CosmosLink, LinkTestResponse, SocketEvent} from "../../../common/CommonInterface";
import type {HttpMethod} from "../../../common/projects/CosmosContract";
import {exclusive} from "../../../common/utils/ExclusiveHelper";
import {createStore, useStore} from "../store/CosmosStore.Controller";

const MAX_MESSAGES = 200;

interface TestState {
    linkId: string;
    sending: boolean;
    response: LinkTestResponse | null;
    socketOpen: boolean;
    messages: SocketEvent[];
}

const EMPTY: TestState = {linkId: "", sending: false, response: null, socketOpen: false, messages: []};

const testStore = createStore<TestState>(EMPTY);
export const useLinkTest = () => useStore(testStore);

let unsubscribe: (() => void) | null = null;

/** Starts a fresh test for one link. Closes the socket of the link that was open before. */
export function resetTest(linkId: string): void {
    const previous = testStore.get();
    if (previous.linkId && previous.linkId !== linkId && previous.socketOpen) {
        void window.api.socketClose(previous.linkId);
    }
    testStore.set({...EMPTY, linkId});
    listen();
}

/** Listens for socket events only while a link page is open. */
function listen(): void {
    if (unsubscribe) {
        return;
    }
    unsubscribe = window.api.onSocketEvent((event) => {
        testStore.set((state) => {
            if (event.id !== state.linkId) {
                return state;
            }
            const socketOpen = event.type === "open" ? true : event.type === "close" || event.type === "error" ? false : state.socketOpen;
            return {...state, socketOpen, messages: [...state.messages, event].slice(-MAX_MESSAGES)};
        });
    });
}

/** Closes the socket and stops listening. Called when the link page goes away. */
export function stopTest(): void {
    const {linkId, socketOpen} = testStore.get();
    if (socketOpen) {
        void window.api.socketClose(linkId);
    }
    unsubscribe?.();
    unsubscribe = null;
    testStore.set(EMPTY);
}

export const sendTestRequest = exclusive(async (link: CosmosLink, method: HttpMethod, path: string, body: string): Promise<void> => {
    testStore.set((state) => ({...state, sending: true, response: null}));
    try {
        const response = await window.api.sendRequest({link, method, path, body});
        testStore.set((state) => ({...state, sending: false, response}));
    } catch (error) {
        testStore.set((state) => ({
            ...state,
            sending: false,
            response: {ok: false, status: 0, statusText: "", millis: 0, headers: {}, body: "", truncated: false, error: (error as Error).message}
        }));
    }
});

export const openSocket = exclusive(async (link: CosmosLink): Promise<void> => {
    testStore.set((state) => ({...state, messages: []}));
    await window.api.socketOpen(link);
});

export const closeSocket = (linkId: string) => window.api.socketClose(linkId);

export async function sendSocketText(linkId: string, text: string): Promise<void> {
    await window.api.socketSend(linkId, text);
    testStore.set((state) => ({
        ...state,
        messages: [...state.messages, {id: linkId, type: "message" as const, text: `> ${text}`, at: Date.now()}].slice(-MAX_MESSAGES)
    }));
}

export const clearMessages = () => testStore.set((state) => ({...state, messages: []}));
