import { handleAdminMe } from "../../../_shared/auth-api.mjs";

export const onRequestGet = ({ request, env }) => handleAdminMe(request, env);
