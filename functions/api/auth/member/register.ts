import { handleMemberRegister } from "../../../_shared/auth-api.mjs";

export const onRequestPost = ({ request, env }) => handleMemberRegister(request, env);
