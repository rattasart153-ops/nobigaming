import { handleMemberMe } from "../../../_shared/auth-api.mjs";

export const onRequestGet = ({ request, env }) => handleMemberMe(request, env);
