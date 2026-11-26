import { handleAdminLogin } from "../../../_shared/auth-api.mjs";

export const onRequestPost = ({ request, env }) => handleAdminLogin(request, env);
