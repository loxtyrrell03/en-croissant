const owners = new WeakMap<object, string>();
export function ownTabTree(store: object, id: string) {
    owners.set(store, id);
}
export function tabTreeOwner(store: object) {
    return owners.get(store);
}
