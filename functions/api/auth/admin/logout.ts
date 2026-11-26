import { handleAdminLogout } from "../../../_shared/auth-api.mjs";

export const onRequestPost = ({ request, env }) => handleAdminLogout(request, env);
