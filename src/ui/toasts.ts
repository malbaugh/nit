import { Toast } from "@base-ui/react/toast";

/** One toast manager for the app, so state code outside React can raise toasts. */
export const toasts = Toast.createToastManager();
